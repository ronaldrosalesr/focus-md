// Focus.MD desktop shell. The app itself is the same HTML as the web version; this adds
// real files. The window can only touch files the person chose (in a dialog or by
// opening them from the system), and every read and write of those goes through here.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Files {
    allowed: Mutex<HashSet<PathBuf>>,
    pending: Mutex<Vec<PathBuf>>,
    ready: Mutex<bool>,
    closing: AtomicBool,
    loaded: OnceLock<()>,
}

#[derive(Serialize)]
struct Opened {
    path: String,
    name: String,
    content: String,
    mtime: u64,
}

#[derive(Serialize)]
struct Saved {
    path: String,
    name: String,
    mtime: u64,
}

fn allowed_list(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("allowed-files.json"))
}

// Runs before the first use of the list, whichever comes first. A Mac can deliver a
// double-clicked file before the app has finished starting, and writing the list before
// reading it would forget every file chosen earlier.
fn ensure_loaded(app: &AppHandle) {
    app.state::<Files>().loaded.get_or_init(|| {
        let Some(file) = allowed_list(app) else { return };
        let Ok(text) = fs::read_to_string(file) else { return };
        let Ok(list) = serde_json::from_str::<Vec<PathBuf>>(&text) else { return };
        app.state::<Files>().allowed.lock().unwrap().extend(list);
    });
}

// Remembered so Save keeps working on a chosen file after the app restarts.
fn allow(app: &AppHandle, path: &Path) {
    ensure_loaded(app);
    let state = app.state::<Files>();
    let mut allowed = state.allowed.lock().unwrap();
    if !allowed.insert(path.to_path_buf()) {
        return;
    }
    if let Some(file) = allowed_list(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let list: Vec<&PathBuf> = allowed.iter().collect();
        if let Ok(text) = serde_json::to_string(&list) {
            let _ = fs::write(file, text);
        }
    }
}

fn is_allowed(app: &AppHandle, path: &Path) -> bool {
    ensure_loaded(app);
    app.state::<Files>().allowed.lock().unwrap().contains(path)
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn mtime(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read(path: &Path) -> Result<Opened, String> {
    let bytes = fs::read(path).map_err(|e| format!("Couldn't open {}: {e}", file_name(path)))?;
    // Refuse rather than guess: decoding with replacements and saving would damage the file.
    let content = String::from_utf8(bytes).map_err(|_| format!("{} isn't a UTF-8 text file.", file_name(path)))?;
    Ok(Opened { path: path.to_string_lossy().into_owned(), name: file_name(path), content, mtime: mtime(path) })
}

// Writes next to the file, then swaps it in, so a crash can't leave a half-written document.
// A protected folder may refuse the extra file while still allowing the chosen one, so that
// case writes to the file directly.
fn write_safely(path: &Path, content: &str) -> Result<(), String> {
    let real = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let tmp = real.with_file_name(format!(".{}.focusmd-tmp", file_name(&real)));
    let fail = |e: std::io::Error| format!("Couldn't save {}: {e}", file_name(path));
    if fs::write(&tmp, content).is_err() {
        let _ = fs::remove_file(&tmp);
        return fs::write(&real, content).map_err(fail);
    }
    if let Ok(meta) = fs::metadata(&real) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, &real).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        fail(e)
    })
}

#[tauri::command]
async fn open_dialog(app: AppHandle) -> Result<Option<Opened>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    allow(&app, &path);
    read(&path).map(Some)
}

#[tauri::command]
async fn read_opened(app: AppHandle, path: String) -> Result<Opened, String> {
    let path = PathBuf::from(path);
    if !is_allowed(&app, &path) {
        return Err("That file wasn't opened from your system.".into());
    }
    read(&path)
}

// Files the system asked to open before the page was ready to hear about them.
#[tauri::command]
async fn take_pending(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<Files>();
    *state.ready.lock().unwrap() = true;
    let files = std::mem::take(&mut *state.pending.lock().unwrap());
    Ok(files.iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

// Autosave passes ask = false: if the file changed elsewhere it writes nothing and reports
// CONFLICT, so a background save can never replace someone else's changes.
// Ok(None) means the person chose to keep the version on disk.
#[tauri::command]
async fn save_file(app: AppHandle, path: String, content: String, known_mtime: u64, ask: bool) -> Result<Option<Saved>, String> {
    let path = PathBuf::from(path);
    if !is_allowed(&app, &path) {
        return Err("NO_ACCESS".into());
    }
    let current = mtime(&path);
    if current != 0 && current != known_mtime {
        if !ask {
            return Err("CONFLICT".into());
        }
        let overwrite = app
            .dialog()
            .message(format!("{} changed on disk since you opened it. Replace it with your version?", file_name(&path)))
            .title("File changed")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Replace".into(), "Cancel".into()))
            .blocking_show();
        if !overwrite {
            return Ok(None);
        }
    }
    write_safely(&path, &content)?;
    Ok(Some(Saved { name: file_name(&path), mtime: mtime(&path), path: path.to_string_lossy().into_owned() }))
}

// The file isn't on the approved list, so the person decides, seeing exactly which file it is.
#[tauri::command]
async fn ask_access(app: AppHandle, path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let (keep, copy) = ("Save to This File".to_string(), "Save a Copy".to_string());
    let answer = app
        .dialog()
        .message(format!("Save your changes to this file, or make a copy and leave it as it is?\n\n{}", path.display()))
        .title(format!("Save changes to {}?", file_name(&path)))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(keep.clone(), copy.clone(), "Cancel".into()))
        .blocking_show_with_result();
    Ok(match answer {
        MessageDialogResult::Custom(label) if label == keep => {
            allow(&app, &path);
            "file".into()
        }
        MessageDialogResult::Custom(label) if label == copy => "copy".into(),
        _ => "cancel".into(),
    })
}

#[tauri::command]
async fn ask_copy(app: AppHandle, message: String) -> Result<bool, String> {
    Ok(app
        .dialog()
        .message(message)
        .title("Couldn't save")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Save a Copy".into(), "Not Now".into()))
        .blocking_show())
}

#[tauri::command]
async fn save_as(app: AppHandle, name: String, content: String) -> Result<Option<Saved>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    fs::write(&path, &content).map_err(|e| format!("Couldn't save {}: {e}", file_name(&path)))?;
    allow(&app, &path);
    Ok(Some(Saved { name: file_name(&path), mtime: mtime(&path), path: path.to_string_lossy().into_owned() }))
}

// Links from a document go to the person's browser, and only ordinary web and mail links.
#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("That kind of link can't be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn finish_close(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

// Lets the page finish writing before the app goes away. The timer means a stuck page
// can't stop someone from quitting.
fn request_exit(app: &AppHandle) {
    let state = app.state::<Files>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("close-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        handle.exit(0);
    });
}

fn open_from_system(app: &AppHandle, path: PathBuf) {
    if !path.is_file() {
        return;
    }
    allow(app, &path);
    let state = app.state::<Files>();
    if *state.ready.lock().unwrap() {
        let _ = app.emit("open-file", path.to_string_lossy().into_owned());
    } else {
        state.pending.lock().unwrap().push(path);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// Mac only: Windows keeps its window clean and uses the same shortcuts through the page.
#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    let item = |id: &str, label: &str, keys: &str| MenuItemBuilder::with_id(id, label).accelerator(keys).build(app);
    let app_menu = SubmenuBuilder::new(app, "Focus.MD")
        // The page's own About, so Mac and Windows show the same thing.
        .item(&MenuItemBuilder::with_id("about", "About Focus.MD").build(app)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit Focus.MD", "CmdOrCtrl+Q")?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new", "New", "CmdOrCtrl+N")?)
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("save-as", "Save As…", "CmdOrCtrl+Shift+S")?)
        .separator()
        .close_window()
        .build()?;
    // Undo and Redo go to the app's own history, which covers both sides.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", "CmdOrCtrl+Z")?)
        .item(&item("redo", "Redo", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &window]).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().0 == "quit" {
            request_exit(app);
        } else {
            let _ = app.emit("menu", event.id().0.clone());
        }
    });
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        // Registered first: a second launch on Windows hands its file to the open window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in args.iter().skip(1) {
                open_from_system(app, PathBuf::from(arg));
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Files::default())
        .invoke_handler(tauri::generate_handler![open_dialog, read_opened, take_pending, save_file, save_as, ask_access, ask_copy, open_external, finish_close])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_exit(window.app_handle());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(target_os = "macos")]
            build_menu(&handle)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Focus.MD")
                .inner_size(1280.0, 800.0)
                .min_inner_size(480.0, 480.0)
                // The page handles its own drag and drop, including moving text in the preview.
                .disable_drag_drop_handler()
                // A document can't navigate the app away from itself.
                .on_navigation(|url| url.host_str() == Some("localhost") || url.host_str() == Some("tauri.localhost"))
                .build()?;
            for arg in std::env::args().skip(1) {
                open_from_system(&handle, PathBuf::from(arg));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Focus.MD couldn't start");

    app.run(|_handle, _event| {
        // Double-clicking a file on a Mac arrives as an event, not as an argument.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    open_from_system(_handle, path);
                }
            }
        }
    });
}

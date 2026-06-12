use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};

struct CloseToTray(AtomicBool);

#[derive(Serialize)]
struct ForegroundActivity {
    title: String,
    process: String,
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn save_state_to_data_dir(data_dir: String, state_json: String) -> Result<(), String> {
    let dir = PathBuf::from(data_dir);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    fs::write(dir.join("dayneko-state.json"), state_json).map_err(|err| err.to_string())
}

#[tauri::command]
fn get_machine_key() -> String {
    let mut source = String::new();
    for key in ["COMPUTERNAME", "USERDOMAIN", "USERNAME", "PROCESSOR_IDENTIFIER"] {
        if let Ok(value) = std::env::var(key) {
            source.push_str(&value);
            source.push('|');
        }
    }
    if source.is_empty() {
        source = "dayneko-local-device".to_string();
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    format!("dn-device-{:016x}", hasher.finish())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_foreground_activity() -> Result<ForegroundActivity, String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == std::ptr::null_mut() {
            return Ok(ForegroundActivity {
                title: String::new(),
                process: String::new(),
            });
        }

        let title_len = GetWindowTextLengthW(hwnd);
        let mut title_buffer = vec![0u16; title_len.saturating_add(1) as usize];
        let title_read = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let title = String::from_utf16_lossy(&title_buffer[..title_read.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return Ok(ForegroundActivity {
                title,
                process: String::new(),
            });
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle == std::ptr::null_mut() {
            return Ok(ForegroundActivity {
                title,
                process: String::new(),
            });
        }

        let mut path_buffer = vec![0u16; 32768];
        let mut size = path_buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, path_buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        let process_path = if ok == 0 {
            String::new()
        } else {
            String::from_utf16_lossy(&path_buffer[..size as usize])
        };
        let process = PathBuf::from(process_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();

        Ok(ForegroundActivity { title, process })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_foreground_activity() -> Result<ForegroundActivity, String> {
    Ok(ForegroundActivity {
        title: String::new(),
        process: String::new(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .manage(CloseToTray(AtomicBool::new(true)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            get_foreground_activity,
            get_machine_key,
            save_state_to_data_dir
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 DayNeko", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("dayneko-tray")
                .tooltip("DayNeko")
                .icon(app.default_window_icon().expect("missing app icon").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            if std::env::args().any(|arg| arg == "--silent") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .state::<CloseToTray>()
                    .0
                    .load(Ordering::Relaxed);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run DayNeko");
}

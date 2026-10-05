// 蜘蛛织毛线桌面端：主窗口加载同一份前端构建产物（与网页版完全一致）。
// 系统托盘：主窗口点 × 隐藏到托盘（不退出，歌词浮窗继续可用），
// 托盘菜单 = 显示主窗口 / 歌词浮窗开关（发事件给主窗口 JS 执行）/ 退出。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

fn main() {
    tauri::Builder::default()
        // 多实例互斥：必须最先注册。已有实例在跑时，二次启动直接退出并唤起原窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            // 主窗口点 ×：拦截并隐藏到托盘；歌词浮窗（lyric-pip/lyric-pop）照常关闭
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let pip = MenuItem::with_id(app, "pip", "打开 / 关闭歌词浮窗", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pip, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false) // 菜单只在右键弹；左键直接显示主窗口
                .tooltip("蜘蛛织毛线")
                .on_tray_icon_event(|tray, event| {
                    // 左键单击托盘图标 = 显示主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    // 歌词浮窗的创建/关闭逻辑在前端（pipLyrics.js），这里只发信号
                    "pip" => {
                        let _ = app.emit("lp-tray-pip", ());
                    }
                    "quit" => {
                        // 先优雅关闭所有窗口再退出，避免 WebView2 报
                        // “failed to unregister class ... error 1412”
                        for label in ["lyric-pop", "lyric-pip", "main"] {
                            if let Some(w) = app.get_webview_window(label) {
                                let _ = w.close();
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

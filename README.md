# 🎛️ Theater Control Panel

**Theater Control Panel** is a modular, high-performance web and desktop dashboard designed for live streamers and content creators. It provides customizable dock layouts, multi-platform integrations, and overlay controls for live stream production.

---

## 💡 Recommendation & Disclaimer

> [!TIP]
> **Recommended Pairing with [Theater Reader](https://github.com/Mortygotvr/Theater-reader)**:
> While Theater Control Panel can operate standalone, using it alongside **Theater Reader** is **strongly recommended**. Certain platform APIs (especially **Kick live chat**) can be difficult to connect directly; Theater Reader handles background connection stability, avatar caching, and WebSocket relaying seamlessly.

---

## ✨ Features

- 🧩 **Modular Dock Layout System**: Customize docks for chat streams, OBS controls, social media feeds, and web docks.
- 💬 **Multi-Platform Modules**: Pre-built TCP modules for Twitch, Kick, Discord, Bluesky, Patreon, X (Twitter), and BeatSaber.
- 🖥️ **Desktop Application**: Run directly as a desktop application (`ControlPanel.exe`).
- 🎭 **Custom Overlays**: Includes pre-packaged HTML overlays and Lua script integration for OBS Studio.

---

## 🚀 Quick Start

1. Download and run `ControlPanel.exe`.
2. Drag, dock, and customize your layout modules.
3. Connect your stream accounts or local WebSocket servers (e.g. Theater Reader & OBS Studio).

---

## 🧩 Creating Your Own TCP Module

You can extend Theater Control Panel by building custom `.tcp` JavaScript modules placed inside the `modules/` directory.

### Quick Example (`modules/my_module.tcp`):

```javascript
// @theater-tcp-module
(function() {
    window.TheaterController.registerModule("my_module", {
        name: "My Custom Module",
        description: "Custom stream integration and trigger actions.",
        configFields: [
            { id: "api_key", label: "API Key", type: "password", default: "" }
        ],
        onLoad(config) {
            console.log("[My Module] Loaded with config:", config);
        },
        onUnload() {
            console.log("[My Module] Unloaded.");
        }
    });

    // Register a custom action trigger command
    window.TheaterController.registerCommand(
        "my_action",
        async (inputs, matches, payload) => {
            const msg = window.TheaterController.replaceVariables(inputs.messageText, matches, payload);
            console.log("Executed action:", msg);
        },
        {
            label: "Send Custom Alert",
            fields: [
                { id: "messageText", label: "Message", type: "text", default: "Hello {username}!" }
            ]
        },
        "my_module"
    );
})();
```

For full documentation on registering triggers, context providers, template variables (`{username}`, `{1}`), and hidden browser webview automation, see the **[TCP Module Development Guide](https://github.com/Mortygotvr/Theater-Control-panel/blob/main/modules/README.md)**.

---

## 🔒 License

Licensed under the **MIT License (with Non-Commercial / No-Resale Restriction)**. See [LICENSE](https://github.com/Mortygotvr/Theater-Control-panel/blob/main/LICENSE) for details.

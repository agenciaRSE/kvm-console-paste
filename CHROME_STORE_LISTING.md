# Chrome Web Store Listing (v1.1.0)

Name and summary come from `_locales/*/messages.json` (`extName`, `extDescription`).
Paste each description in its language tab of the developer dashboard.

## Summary (from the manifest, 132 chars max)

- en: Paste text into noVNC KVM web consoles (IONOS, Proxmox, Plesk) by typing it as keystrokes.
- es: Pega texto en consolas KVM web noVNC (IONOS, Proxmox, Plesk) tecleándolo como pulsaciones.

## Description — English

Paste into the KVM web console of your server.

Web KVM consoles (noVNC) used by IONOS, Proxmox, Plesk and many hosting providers don't support the clipboard: Ctrl+V does nothing, so long commands, passwords and config files have to be typed by hand. KVM Console Paste types the text for you, keystroke by keystroke.

How it works:
1. Open your KVM console from your hosting panel.
2. Click the extension icon and allow it on that site. It lists every domain it needs, including the console frame when it lives on another domain (as on IONOS).
3. Click inside the console and press Ctrl+V. Or use "Send to console" in the popup (Alt+Shift+V opens it), or right-click the console.

Safe by design:
• Asks before running commands: text with line breaks shows a preview first, because each line break presses Enter on the server.
• Warns about characters such as ñ, á or € that depend on the server keyboard layout. Useful for passwords.
• Blocked on every site by default. You enable each site with one click and can remove it at any time.

Features:
• Works with any noVNC console, also inside iframes on another domain.
• Adjustable typing speed (10 to 200 ms per character) and delay after Enter for scripts.
• Progress on the page with a Cancel button.
• Interface in English and Spanish. Keyboard accessible.

What's new in 1.1:
• Fixed: it did not work on IONOS, whose console runs in a frame on another domain.
• Ctrl+V no longer reaches the server as a keystroke.
• Confirmation for multi-line pastes, warning for non-ASCII characters, Spanish interface, keyboard shortcut.

Privacy:
• No data collection. Nothing leaves your browser.
• The clipboard is read only when you paste, typed into the console and never stored.
• No external servers, no analytics.

Open source (MIT): https://github.com/agenciaRSE/kvm-console-paste
Made by AGENCIA RSE (agenciarse.com).

## Descripción — Español

Pega en la consola KVM web de tu servidor.

Las consolas KVM web (noVNC) de IONOS, Proxmox, Plesk y muchos proveedores no tienen portapapeles: Ctrl+V no hace nada y toca teclear a mano comandos, contraseñas y ficheros de configuración. KVM Console Paste teclea el texto por ti, pulsación a pulsación.

Cómo funciona:
1. Abre la consola KVM desde el panel de tu proveedor.
2. Pulsa el icono de la extensión y actívala en ese sitio. Te muestra todos los dominios que necesita, incluido el del frame de la consola cuando está en otro dominio (como en IONOS).
3. Haz clic en la consola y pulsa Ctrl+V. O usa «Enviar a la consola» en el popup (Alt+Mayús+V lo abre), o haz clic derecho en la consola.

Segura por diseño:
• Pregunta antes de ejecutar comandos: el texto con saltos de línea muestra una vista previa, porque cada salto pulsa Enter en el servidor.
• Avisa de caracteres como ñ, á o € que dependen del teclado del servidor. Útil con contraseñas.
• Bloqueada en todas las webs por defecto. Activas cada sitio con un clic y lo quitas cuando quieras.

Funciones:
• Funciona con cualquier consola noVNC, también dentro de iframes de otro dominio.
• Velocidad de tecleo ajustable (de 10 a 200 ms por carácter) y pausa tras Enter para scripts.
• Progreso en la página con botón Cancelar.
• Interfaz en español e inglés. Accesible con teclado.

Novedades de la 1.1:
• Arreglado: no funcionaba en IONOS, cuya consola va en un frame de otro dominio.
• Ctrl+V ya no llega al servidor como pulsación.
• Confirmación al pegar varias líneas, aviso de caracteres no ASCII, interfaz en español y atajo de teclado.

Privacidad:
• No recoge ningún dato. Nada sale de tu navegador.
• El portapapeles se lee solo cuando pegas, se teclea en la consola y no se guarda.
• Sin servidores externos ni analítica.

Código abierto (MIT): https://github.com/agenciaRSE/kvm-console-paste
Hecha por AGENCIA RSE (agenciarse.com).

## Category
Developer Tools

## Graphics (store-assets/, regenerate with `bash store-assets/src/build.sh`)

| Slot | en | es |
|---|---|---|
| Store icon 128×128 | store-icon-128x128.png | same |
| Screenshots 1280×800 | screenshot-1..4-*-en.png | screenshot-1..4-*-es.png |
| Small promo tile 440×280 | promo-tile-440x280-en.png | promo-tile-440x280-es.png |
| Marquee 1400×560 | marquee-1400x560-en.png | marquee-1400x560-es.png |

## Permissions justification (dashboard "Privacy practices")

- clipboardRead: read the clipboard only when the user pastes from the context menu.
- scripting: inject the paste scripts on the sites the user enables (registered per site).
- activeTab / webNavigation: find the frame that holds the console in the current tab.
- storage: save settings and the list of enabled sites, locally.
- contextMenus: "Paste to KVM console" entry.
- Host permissions: optional, requested per site when the user clicks "Enable on this site".

## Tags/Keywords
kvm, vnc, novnc, console, paste, clipboard, ionos, proxmox, plesk, vps, server, terminal, remote

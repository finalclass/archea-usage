import QtQuick
import Quickshell
import Quickshell.Io

Item {
    id: root
    property QtObject bar: null
    property var settings: ({})
    property string caption: "AI …"
    property string details: "Ładowanie…"
    property bool popupOpen: false
    property string clientScript: settings.clientScript || Quickshell.env("HOME") + "/.local/share/archea-usage/omarchy/usage-widget.ts"
    property string clientConfig: settings.clientConfig || Quickshell.env("HOME") + "/.config/archea-usage/client.json"
    implicitWidth: label.implicitWidth + 16
    implicitHeight: bar ? bar.height : 30
    Text { id: label; anchors.centerIn: parent; text: root.caption; color: root.bar ? root.bar.foreground : "white"; font.pixelSize: 14 }
    MouseArea { anchors.fill: parent; onClicked: { root.popupOpen = !root.popupOpen; if (!request.running) request.running = true } }
    Timer { interval: 300000; running: true; repeat: true; triggeredOnStart: true; onTriggered: { if (!request.running) request.running = true } }
    Process {
        id: request
        command: ["deno", "run", "--no-config", "--allow-env=HOME", "--allow-read=" + root.clientConfig, "--allow-net", root.clientScript, root.clientConfig]
        stdout: StdioCollector { waitForEnd: true; onStreamFinished: { try { var d = JSON.parse(text); root.caption = d.text; root.details = d.tooltip } catch (e) { root.caption = "AI !"; root.details = "Nieprawidłowa odpowiedź klienta" } } }
    }
    PopupWindow {
        id: popup
        visible: root.popupOpen
        anchor.item: root
        anchor.rect.y: root.height
        implicitWidth: 440
        implicitHeight: info.implicitHeight + 32
        color: "#101820"
        Text { id: info; x: 16; y: 16; width: 408; text: root.details; textFormat: Text.PlainText; wrapMode: Text.Wrap; color: "#eeeeee"; font.pixelSize: 14 }
        MouseArea { anchors.fill: parent; onClicked: root.popupOpen = false }
    }
}

import QtQuick
import Quickshell
import Quickshell.Io

Item {
    id: root
    property QtObject bar: null
    property var settings: ({})
    property string caption: "AI …"
    property string details: "Ładowanie…"
    property var cards: []
    property string severity: "normal"
    property bool popupOpen: false
    property string clientScript: settings.clientScript || Quickshell.env("HOME") + "/.local/share/archea-usage/omarchy/usage-widget.ts"
    property string clientConfig: settings.clientConfig || Quickshell.env("HOME") + "/.config/archea-usage/client.json"
    function accent(level) { return level === "critical" ? "#ff7078" : level === "warning" ? "#ffd166" : "#8ed3ff" }
    implicitWidth: label.implicitWidth + 16
    implicitHeight: bar ? bar.height : 30
    Text { id: label; anchors.centerIn: parent; text: root.caption; color: root.accent(root.severity); font.pixelSize: 14 }
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: mouse => {
            if (mouse.button === Qt.LeftButton) browser.running = true
            else { root.popupOpen = !root.popupOpen; if (!request.running) request.running = true }
        }
    }
    Process { id: browser; command: ["xdg-open", "https://szymon.archea.dev"] }
    Timer { interval: 300000; running: true; repeat: true; triggeredOnStart: true; onTriggered: { if (!request.running) request.running = true } }
    Process {
        id: request
        command: ["deno", "run", "--no-config", "--allow-env=HOME", "--allow-read=" + root.clientConfig, "--allow-net", root.clientScript, root.clientConfig]
        stdout: StdioCollector { waitForEnd: true; onStreamFinished: { try { var d = JSON.parse(text); root.caption = d.text; root.details = d.tooltip; root.cards = d.cards || []; root.severity = d.class || "normal" } catch (e) { root.caption = "AI !"; root.details = "Nieprawidłowa odpowiedź klienta" } } }
    }
    PopupWindow {
        id: popup
        visible: root.popupOpen
        anchor.item: root
        anchor.rect.y: root.height
        implicitWidth: 480
        implicitHeight: content.implicitHeight + 32
        color: "#101820"
        Column {
            id: content
            x: 16; y: 16; width: 448; spacing: 12
            Text { text: "Zużycie AI"; color: "#eeeeee"; font.pixelSize: 18; font.bold: true }
            Grid {
                width: parent.width; columns: 2; spacing: 12
                Repeater {
                    model: root.cards
                    Rectangle {
                        required property var modelData
                        width: 218; height: 180; radius: 12
                        color: modelData.level === "critical" ? "#39232b" : modelData.level === "warning" ? "#352e20" : "#1b2935"
                        border.color: root.accent(modelData.level); border.width: 1
                        MouseArea { anchors.fill: parent; onClicked: browser.running = true }
                        Column {
                            x: 12; y: 12; width: parent.width - 24; spacing: 8
                            Text { text: modelData.label; color: root.accent(modelData.level); font.pixelSize: 16; font.bold: true }
                            Text { width: parent.width; text: modelData.value; color: root.accent(modelData.level); wrapMode: Text.Wrap; font.pixelSize: 13 }
                            Text { text: modelData.updated; color: "#a9b6c3"; font.pixelSize: 11 }
                        }
                    }
                }
            }
            Text { visible: root.cards.length === 0; width: parent.width; text: root.details; color: "#eeeeee"; wrapMode: Text.Wrap }
        }
    }
}

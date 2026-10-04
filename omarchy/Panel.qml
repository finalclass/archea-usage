import QtQuick
import Quickshell
import Quickshell.Io

Item {
    id: root
    property QtObject bar: null
    property var settings: ({})
    property string caption: ""
    property string details: "Ładowanie…"
    property var cards: []
    property string severity: "normal"
    property bool popupOpen: false
    property string clientScript: settings.clientScript || Quickshell.env("HOME") + "/.local/share/archea-usage/omarchy/usage-widget.ts"
    property string clientConfig: settings.clientConfig || Quickshell.env("HOME") + "/.config/archea-usage/client.json"
    readonly property int slot: bar && bar.barSize > 0 ? bar.barSize : 33
    readonly property color metal: bar && bar.foreground.a > 0.2 ? bar.foreground : "#ead8c4"

    function accent(level) {
        return level === "critical" ? "#ff7078" : level === "warning" ? "#ffd166" : "#8ed3ff"
    }

    function toggleCards() {
        popupOpen = !popupOpen
        if (popupOpen && !request.running) request.running = true
    }

    implicitWidth: bar && bar.vertical ? slot : 32
    implicitHeight: bar && bar.vertical ? 32 : slot

    Canvas {
        id: skull
        anchors.centerIn: parent
        width: 24
        height: 24
        antialiasing: true
        property color metal: root.metal
        onMetalChanged: requestPaint()
        onWidthChanged: requestPaint()
        Component.onCompleted: requestPaint()
        onPaint: {
            var ctx = getContext("2d")
            try {
                var s = width / 24
                function u(v) { return v * s }
                function fillDisk(cx, cy, r) {
                    ctx.beginPath()
                    ctx.save()
                    ctx.translate(cx, cy)
                    ctx.scale(Math.max(r, 0.2), Math.max(r, 0.2))
                    ctx.arc(0, 0, 1, 0, Math.PI * 2, false)
                    ctx.restore()
                    ctx.fill()
                }
                function fillLine(x1, y1, x2, y2, thick) {
                    var dx = x2 - x1
                    var dy = y2 - y1
                    var len = Math.sqrt(dx * dx + dy * dy)
                    if (len < 0.1) return
                    var px = -dy / len * thick / 2
                    var py = dx / len * thick / 2
                    ctx.beginPath()
                    ctx.moveTo(x1 + px, y1 + py)
                    ctx.lineTo(x2 + px, y2 + py)
                    ctx.lineTo(x2 - px, y2 - py)
                    ctx.lineTo(x1 - px, y1 - py)
                    ctx.closePath()
                    ctx.fill()
                }
                var nx = [3.6, 9.4, 16.8, 20.6, 6.4, 13.8]
                var ny = [9.8, 3.5, 6.6, 13.4, 16.6, 21.2]
                var ea = [0, 1, 2, 0, 4, 2, 1, 3, 2]
                var eb = [1, 2, 3, 4, 5, 4, 4, 5, 5]
                ctx.clearRect(0, 0, width, height)
                ctx.globalCompositeOperation = "source-over"
                ctx.fillStyle = metal
                var thick = u(1.5)
                for (var i = 0; i < ea.length; i++)
                    fillLine(u(nx[ea[i]]), u(ny[ea[i]]), u(nx[eb[i]]), u(ny[eb[i]]), thick)
                for (var n = 0; n < nx.length; n++)
                    fillDisk(u(nx[n]), u(ny[n]), u(2.5))
                ctx.globalCompositeOperation = "destination-out"
                for (var k = 0; k < nx.length; k++)
                    fillDisk(u(nx[k]), u(ny[k]), u(1.25))
            } catch (e) {
                console.log("archea paint failed", e)
                ctx.globalCompositeOperation = "source-over"
                ctx.fillStyle = "#ead8c4"
                ctx.fillRect(4, 4, 16, 16)
            }
        }
    }

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: root.toggleCards()
    }

    Timer {
        interval: 300000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: { if (!request.running) request.running = true }
    }

    Process {
        id: request
        command: ["deno", "run", "--no-config", "--allow-env=HOME", "--allow-read=" + root.clientConfig, "--allow-net", root.clientScript, root.clientConfig]
        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: {
                try {
                    var d = JSON.parse(text)
                    root.caption = d.text
                    root.details = d.tooltip
                    root.cards = d.cards || []
                    root.severity = d.class || "normal"
                } catch (e) {
                    root.caption = ""
                    root.details = "Nieprawidłowa odpowiedź klienta"
                    root.cards = []
                }
            }
        }
    }

    PopupWindow {
        id: popup
        visible: root.popupOpen
        color: "#101820"
        implicitWidth: 480
        implicitHeight: content.implicitHeight + 32
        anchor.item: root
        anchor.rect.x: root.width - implicitWidth
        anchor.rect.y: bar && bar.position === "bottom" ? -implicitHeight : root.height
        anchor.adjustment: PopupAdjustment.Slide

        Column {
            id: content
            x: 16
            y: 16
            width: 448
            spacing: 12
            Text {
                text: "Zużycie AI"
                color: "#eeeeee"
                font.pixelSize: 18
                font.bold: true
            }
            Grid {
                width: parent.width
                columns: 2
                spacing: 12
                Repeater {
                    model: root.cards
                    Rectangle {
                        required property var modelData
                        width: 218
                        height: 180
                        radius: 12
                        color: modelData.level === "critical" ? "#39232b" : modelData.level === "warning" ? "#352e20" : "#1b2935"
                        border.color: root.accent(modelData.level)
                        border.width: 1
                        Column {
                            x: 12
                            y: 12
                            width: parent.width - 24
                            spacing: 8
                            Text {
                                text: modelData.label
                                color: root.accent(modelData.level)
                                font.pixelSize: 16
                                font.bold: true
                            }
                            Text {
                                width: parent.width
                                text: modelData.value
                                color: root.accent(modelData.level)
                                wrapMode: Text.Wrap
                                font.pixelSize: 13
                            }
                            Text {
                                text: modelData.updated
                                color: "#a9b6c3"
                                font.pixelSize: 11
                            }
                        }
                    }
                }
            }
            Text {
                visible: root.cards.length === 0
                width: parent.width
                text: root.details
                color: "#eeeeee"
                wrapMode: Text.Wrap
            }
        }
    }
}

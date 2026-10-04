import QtQuick
import Quickshell
import Quickshell.Io

Item {
    id: root
    property QtObject bar: null
    property var settings: ({})
    property string caption: ""
    property string details: "Ładowanie…"
    property string summary: ""
    property var cards: []
    property string severity: "normal"
    property bool popupOpen: false
    property string clientScript: settings.clientScript || Quickshell.env("HOME") + "/.local/share/archea-usage/omarchy/usage-widget.ts"
    property string clientConfig: settings.clientConfig || Quickshell.env("HOME") + "/.config/archea-usage/client.json"

    readonly property int slot: bar && bar.barSize > 0 ? bar.barSize : 33
    readonly property color metal: bar && bar.foreground.a > 0.2 ? bar.foreground : "#ead8c4"
    readonly property color muted: "#8fa1b3"
    readonly property color faint: "#6e8294"
    readonly property color ink: "#f3f6f8"
    readonly property int rowCount: Math.ceil(cards.length / 2)

    function accent(level) {
        return level === "critical" || level === "error" ? "#ff7078" : level === "warning" ? "#ffd166" : "#8ed3ff"
    }
    function surface(level, hot) {
        if (level === "critical" || level === "error") return hot ? "#3a2830" : "#2a1e26"
        if (level === "warning") return hot ? "#35301c" : "#292616"
        return hot ? "#1d3144" : "#172533"
    }
    function stroke(level) {
        if (level === "critical" || level === "error") return "#5c3340"
        if (level === "warning") return "#5c5230"
        return "#2c4660"
    }
    function toggleCards() {
        popupOpen = !popupOpen
        if (popupOpen && !request.running) request.running = true
    }
    function applyPayload(text) {
        var d = JSON.parse(text)
        root.caption = d.text
        root.details = d.tooltip
        root.cards = d.cards || []
        root.severity = d.class || "normal"
        root.summary = d.summary || ""
    }

    implicitWidth: bar && bar.vertical ? slot : 32
    implicitHeight: bar && bar.vertical ? 32 : slot

    component UsageCard: Rectangle {
        id: card
        property var meter: ({})
        readonly property bool hasWindows: meter && meter.windows && meter.windows.length > 0
        readonly property bool hasBalance: meter && meter.balance
        readonly property string meterLevel: (meter && meter.level) ? meter.level : "normal"
        radius: 14
        antialiasing: true
        color: root.surface(meterLevel, cardArea.containsMouse)
        border.color: root.stroke(meterLevel)
        border.width: 1
        implicitHeight: body.implicitHeight + foot.implicitHeight + 38

        Column {
            id: body
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: 16
            anchors.rightMargin: 16
            anchors.topMargin: 14
            spacing: 10

            Item {
                width: parent.width
                height: Math.max(nameText.implicitHeight, peakText.implicitHeight)
                Text {
                    id: nameText
                    anchors.left: parent.left
                    anchors.right: peakText.left
                    anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    text: card.meter.label || ""
                    color: root.ink
                    font.pixelSize: 16
                    font.bold: true
                    elide: Text.ElideRight
                }
                Text {
                    id: peakText
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: card.hasWindows ? (card.meter.peakLabel || "") : ""
                    color: root.accent(card.meterLevel)
                    font.pixelSize: 22
                    font.bold: true
                }
            }

            Repeater {
                model: card.hasWindows ? card.meter.windows : []
                Column {
                    required property var modelData
                    width: body.width
                    spacing: 5
                    Item {
                        width: parent.width
                        height: windowName.implicitHeight
                        Text {
                            id: windowName
                            text: modelData.label
                            color: root.muted
                            font.pixelSize: 12
                        }
                        Text {
                            anchors.right: parent.right
                            visible: card.meter.windows.length > 1
                            text: modelData.percentLabel
                            color: root.accent(modelData.level)
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }
                    Rectangle {
                        id: track
                        width: parent.width
                        height: 8
                        radius: 4
                        color: "#101820"
                        Rectangle {
                            readonly property real ratio: Math.max(0, Math.min(1, (modelData.percent || 0) / 100))
                            width: ratio === 0 ? 0 : Math.min(track.width, Math.max(4, track.width * ratio))
                            height: parent.height
                            radius: 4
                            color: root.accent(modelData.level)
                        }
                    }
                    Text {
                        width: parent.width
                        text: modelData.reset ? "reset · " + modelData.reset : "brak daty resetu"
                        color: modelData.reset ? "#d5dee6" : root.faint
                        font.pixelSize: 12
                        elide: Text.ElideRight
                    }
                }
            }

            Column {
                visible: card.hasBalance
                width: parent.width
                spacing: 2
                Row {
                    spacing: 8
                    Text {
                        id: amountText
                        text: card.meter.balance ? card.meter.balance.amount : ""
                        color: root.ink
                        font.pixelSize: 28
                        font.bold: true
                    }
                    Text {
                        text: card.meter.balance ? card.meter.balance.currency : ""
                        color: root.muted
                        font.pixelSize: 13
                        font.bold: true
                        anchors.baseline: amountText.baseline
                    }
                }
                Text {
                    text: "pozostało"
                    color: root.muted
                    font.pixelSize: 12
                }
            }

            Text {
                visible: !card.hasWindows && !card.hasBalance
                text: "Brak danych"
                color: root.muted
                font.pixelSize: 13
            }
        }

        Text {
            id: foot
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.rightMargin: 16
            anchors.bottomMargin: 12
            text: ((card.meter && card.meter.stale) ? "nieaktualne · " : "") + "stan " + ((card.meter && card.meter.updatedTime) || "—")
            color: (card.meter && card.meter.stale) ? root.accent("warning") : root.faint
            font.pixelSize: 11
        }

        MouseArea {
            id: cardArea
            anchors.fill: parent
            hoverEnabled: true
        }
    }

    Canvas {
        id: skull
        anchors.centerIn: parent
        width: 24
        height: 24
        antialiasing: true
        property color metal: root.severity === "normal" ? root.metal : root.accent(root.severity)
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
                    root.applyPayload(text)
                } catch (e) {
                    root.caption = ""
                    root.details = "Nieprawidłowa odpowiedź klienta"
                    root.cards = []
                    root.severity = "error"
                    root.summary = ""
                }
            }
        }
    }

    PopupWindow {
        id: popup
        visible: root.popupOpen
        color: "transparent"
        implicitWidth: 468
        implicitHeight: shell.implicitHeight
        anchor.item: root
        anchor.rect.x: root.width - implicitWidth
        anchor.rect.y: bar && bar.position === "bottom" ? -(implicitHeight + 6) : root.height + 6
        anchor.adjustment: PopupAdjustment.Slide

        Rectangle {
            id: shell
            width: 468
            height: implicitHeight
            implicitHeight: panelColumn.implicitHeight + 32
            radius: 18
            color: "#101820"
            border.color: "#2a3c4e"
            border.width: 1
            antialiasing: true

            Column {
                id: panelColumn
                x: 18
                y: 16
                width: parent.width - 36
                spacing: 14

                Item {
                    width: parent.width
                    height: 28
                    Text {
                        text: "Zużycie AI"
                        color: root.ink
                        font.pixelSize: 18
                        font.bold: true
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Rectangle {
                        width: 28
                        height: 28
                        radius: 14
                        anchors.right: parent.right
                        color: closeArea.containsMouse ? "#243444" : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "×"
                            color: closeArea.containsMouse ? root.ink : root.muted
                            font.pixelSize: 18
                        }
                        MouseArea {
                            id: closeArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.popupOpen = false
                        }
                    }
                }

                Text {
                    width: parent.width
                    visible: root.summary !== ""
                    text: root.summary
                    wrapMode: Text.Wrap
                    color: root.severity === "normal" ? root.muted : root.accent(root.severity)
                    font.pixelSize: 12
                }

                Rectangle {
                    width: parent.width
                    height: 1
                    color: "#243444"
                }

                Column {
                    id: pairs
                    width: parent.width
                    spacing: 12
                    visible: root.cards.length > 0
                    Repeater {
                        model: root.rowCount
                        Row {
                            required property int index
                            width: pairs.width
                            spacing: 12
                            readonly property bool hasRight: index * 2 + 1 < root.cards.length
                            readonly property int cardWidth: Math.max(0, hasRight ? Math.floor((width - spacing) / 2) : width)
                            UsageCard {
                                id: leftCard
                                meter: root.cards[index * 2]
                                width: parent.cardWidth
                                height: parent.hasRight ? Math.max(implicitHeight, rightCard.implicitHeight) : implicitHeight
                            }
                            UsageCard {
                                id: rightCard
                                meter: parent.hasRight ? root.cards[index * 2 + 1] : root.cards[index * 2]
                                visible: parent.hasRight
                                width: parent.hasRight ? parent.cardWidth : 0
                                height: parent.hasRight ? Math.max(leftCard.implicitHeight, implicitHeight) : 0
                            }
                        }
                    }
                }

                Text {
                    visible: root.cards.length === 0
                    width: parent.width
                    text: root.details
                    wrapMode: Text.Wrap
                    color: root.severity === "error" ? root.accent("error") : root.ink
                    font.pixelSize: 13
                }
            }
        }
    }
}

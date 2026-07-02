/*
 * Jarvis integration for the notch shell.
 *
 * The shell owns presentation, windows, tabs, hover behavior, gestures, and
 * settings. All intelligence lives in the Jarvis desktop app (Electron); this
 * bridge is a thin WebSocket client that mirrors conversation state into
 * observable models and forwards user intents back.
 *
 * The desktop app launches the notch with `--jarvis-port <p> --jarvis-token <t>`.
 * Without those arguments the bridge stays in `.disconnected` and the UI shows
 * an offline orb.
 */

import AppKit
import AVFoundation
import Combine
import EventKit
import Foundation
import SwiftUI

enum JarvisPhase: String {
    case disconnected
    case idle
    case listening
    case transcribing
    case thinking
    case speaking

    var isConversationActive: Bool {
        switch self {
        case .listening, .transcribing, .thinking, .speaking:
            return true
        case .disconnected, .idle:
            return false
        }
    }

    var title: String {
        switch self {
        case .disconnected: return String(localized: "Offline")
        case .idle: return String(localized: "Ready")
        case .listening: return String(localized: "Listening")
        case .transcribing: return String(localized: "Transcribing")
        case .thinking: return String(localized: "Thinking")
        case .speaking: return String(localized: "Speaking")
        }
    }
}

struct JarvisTranscriptTurn: Identifiable, Equatable {
    enum Role: String {
        case user
        case jarvis
    }

    let id: String
    let role: Role
    var text: String
    var isFinal: Bool
}

struct JarvisToolActivity: Equatable {
    enum Status: String {
        case error
        case running
        case success
        case warning
    }

    var title: String
    var subtitle: String
    var status: Status
}

private let jarvisEditableNotchSettingDefaults: [String: Any] = [
    "autoHideInactiveNotchMediaPlayer": false,
    "autoRemoveShelfItems": false,
    "autoStartStatsMonitoring": true,
    "autoScrollToNextEvent": true,
    "automaticallySwitchDisplay": true,
    "brightnessStepPercent": 6,
    "chargingBatteryHUDDuration": 3,
    "circularHUDShowValue": true,
    "circularHUDSize": 65.0,
    "circularHUDUseAccentColor": true,
    "clipboardDisplayMode": "panel",
    "clipboardHistorySize": 3,
    "closeGestureEnabled": true,
    "colorHistorySize": 10,
    "coloredSpectrogram": true,
    "colorPickerDisplayMode": "panel",
    "copyOnDrag": false,
    "cornerRadiusScaling": true,
    "dynamicShelf": true,
    "enableBrightnessHUD": true,
    "enableCameraDetection": true,
    "enableCircularHUD": false,
    "enableClipboardManager": true,
    "enableColorPickerFeature": true,
    "enableCreateFromClipboard": true,
    "enableCustomOSD": false,
    "enableDownloadListener": true,
    "enableExtensionFileSharing": true,
    "enableExtensionLiveActivities": true,
    "enableExtensionNotchExperiences": true,
    "enableExtensionNotchInteractiveWebViews": true,
    "enableExtensionNotchMinimalisticOverrides": true,
    "enableExtensionNotchTabs": true,
    "enableFullscreenMediaDetection": true,
    "enableGestures": true,
    "enableHaptics": true,
    "enableHorizontalMusicGestures": true,
    "enableKeyboardBacklightHUD": true,
    "enableLyrics": false,
    "enableMicrophoneDetection": true,
    "enableMinimalisticUI": false,
    "enableNoteCharCount": true,
    "enableNoteColorFiltering": false,
    "enableNotePinning": true,
    "enableNoteSearch": false,
    "enableNotes": false,
    "enableRealTimeWaveform": false,
    "enableReminderLiveActivity": true,
    "enableSafariDownloads": true,
    "enableShadow": true,
    "enableShortcuts": true,
    "enableSneakPeek": false,
    "enableStatsFeature": false,
    "enableSystemHUD": true,
    "enableTerminalFeature": false,
    "enableThirdPartyCalendarApp": false,
    "enableThirdPartyDDCIntegration": false,
    "enableThirdPartyExtensions": true,
    "enableTimerFeature": true,
    "enableVerticalHUD": false,
    "enableVolumeHUD": true,
    "enableWobbleAnimation": false,
    "expandedDragDetection": true,
    "extendHoverArea": false,
    "extensionDiagnosticsLoggingEnabled": true,
    "extensionLiveActivityCapacity": 4,
    "extensionNotchExperienceCapacity": 2,
    "externalDisplayStyle": "Standard Notch",
    "fantasticalDefaultView": "mini",
    "fullBatteryHUDDuration": 3,
    "fullBatteryHUDStyle": "standard",
    "fullBatteryHUDThreshold": 100,
    "gestureSensitivity": 200.0,
    "hideAllDayEvents": false,
    "hideCompletedReminders": true,
    "hideDynamicIslandFromScreenCapture": false,
    "hideNonNotchUntilHover": false,
    "inlineHUD": true,
    "lightingEffect": true,
    "localSendSelectedDeviceID": "",
    "lowBatteryHUDDuration": 3,
    "lowBatteryHUDStyle": "standard",
    "lowBatteryHUDThreshold": 20,
    "mediaController": "Apple Music",
    "minimumHoverDuration": 0.3,
    "mirrorSystemTimer": true,
    "musicControlWindowEnabled": false,
    "musicSkipBehavior": "track",
    "nonNotchHeight": 32.0,
    "notchHeight": 32.0,
    "openNotchOnHover": true,
    "openNotchWidth": 640.0,
    "openShelfByDefault": true,
    "parallaxEffectIntensity": 6.0,
    "playLowBatteryAlertSound": true,
    "playVolumeChangeFeedback": false,
    "playerColorTinting": true,
    "progressBarStyle": "Hierarchical",
    "quickShareProvider": "AirDrop",
    "reminderLeadTime": 5,
    "reminderPresentationStyle": "Ring",
    "reminderSneakPeekDuration": 5.0,
    "reverseScrollGestures": false,
    "reverseSwipeGestures": false,
    "selectedCalendarApp": "fantastical",
    "selectedCameraID": "",
    "selectedDownloadIconStyle": "Only app icon",
    "selectedDownloadIndicatorStyle": "Progress",
    "settingsIconInNotch": true,
    "showBatteryIndicator": true,
    "showBatteryPercentInside": true,
    "showBatteryPercentage": true,
    "showBluetoothBatteryPercentageText": false,
    "showBluetoothDeviceConnections": true,
    "showBluetoothDeviceNameMarquee": false,
    "showCalendar": true,
    "showChargingBatteryHUD": true,
    "showClipboardIcon": true,
    "showColorFormats": true,
    "showColorPickerIcon": true,
    "showCpuGraph": true,
    "showDiskGraph": false,
    "showEmojis": false,
    "showFullBatteryHUD": true,
    "showFullEventTitles": false,
    "showGpuGraph": true,
    "showLiveCanvasInDynamicIsland": false,
    "showLowBatteryHUD": true,
    "showMediaOutputControl": true,
    "showMemoryGraph": true,
    "showMirror": false,
    "showNetworkGraph": false,
    "showOnAllDisplays": false,
    "showPowerStatusIcons": true,
    "showPowerStatusNotifications": true,
    "showProgressPercentages": true,
    "showShuffleAndRepeat": true,
    "showSneakPeekOnTrackChange": true,
    "showSongMetadataInClosedNotch": false,
    "showStandardMediaControls": true,
    "showTimerPresetsInNotchTab": true,
    "sneakPeekStyles": "Default",
    "statsStopWhenNotchCloses": true,
    "statsUpdateInterval": 1.0,
    "systemEventIndicatorShadow": false,
    "systemEventIndicatorUseAccent": false,
    "systemHUDSensitivity": 5,
    "terminalBoldAsBright": true,
    "terminalCursorStyle": "blinkBlock",
    "terminalFontFamily": "",
    "terminalFontSize": 12.0,
    "terminalMaxHeightFraction": 0.4,
    "terminalMouseReporting": true,
    "terminalOpacity": 1.0,
    "terminalOptionAsMeta": true,
    "terminalScrollbackLines": 1000,
    "terminalShellPath": "/bin/zsh",
    "terminalStickyMode": false,
    "tileShowLabels": false,
    "timerControlWindowEnabled": true,
    "timerDisplayMode": "tab",
    "timerIconColorMode": "Adaptive",
    "timerProgressStyle": "Bar",
    "timerShowsCountdown": true,
    "timerShowsLabel": false,
    "timerShowsProgress": true,
    "useBluetoothHUD3DIcon": true,
    "useCircularBluetoothBatteryIndicator": true,
    "useColorCodedBatteryDisplay": true,
    "useColorCodedVolumeDisplay": true,
    "useModernCloseAnimation": true,
    "useMusicVisualizer": true,
    "useSmoothColorGradient": true,
    "verticalHUDHeight": 160.0,
    "verticalHUDInteractive": true,
    "verticalHUDPosition": "right",
    "verticalHUDShowValue": true,
    "volumeStepPercent": 6
]

@MainActor
final class JarvisAssistantModel: ObservableObject {
    @Published var phase: JarvisPhase = .disconnected
    @Published var transcript: [JarvisTranscriptTurn] = []
    @Published var toolActivity: JarvisToolActivity?
    /// Live mic/TTS level in 0...1, streamed from the desktop app while a
    /// conversation is active. Drives orb/visualizer reactivity.
    @Published var audioLevel: Double = 0
    /// URL of the orb page served by the desktop app. When present the notch
    /// renders the real Three.js orb in a web view; nil shows the native glow.
    @Published var orbURL: URL?
}

@MainActor
final class JarvisAssistantBridge: NSObject, ObservableObject {
    static let shared = JarvisAssistantBridge()

    let model = JarvisAssistantModel()

    private var activationHandler: (@MainActor () -> Void)?
    private var deactivationHandler: (@MainActor () -> Void)?
    private var conversationWasActive = false
    private var musicPausedForConversation = false
    private var shouldResumeMusicWhenIdle = false
    private var started = false

    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reconnectAttempt = 0
    private var reconnectWorkItem: DispatchWorkItem?
    private var pingTimer: Timer?
    private let endpoint: (port: Int, token: String)? = {
        var port: Int?
        var token: String?
        let args = ProcessInfo.processInfo.arguments
        for (index, arg) in args.enumerated() {
            guard index + 1 < args.count else { break }
            if arg == "--jarvis-port" { port = Int(args[index + 1]) }
            if arg == "--jarvis-token" { token = args[index + 1] }
        }
        guard let port, let token else { return nil }
        return (port, token)
    }()

    private override init() {
        super.init()
    }

    // MARK: - Lifecycle (API kept from the original bridge; AppDelegate calls these)

    func start(
        activate: @escaping @MainActor () -> Void,
        deactivate: @escaping @MainActor () -> Void
    ) {
        activationHandler = activate
        deactivationHandler = deactivate
        guard !started else { return }
        started = true
        connect()
    }

    func stop() {
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        pingTimer?.invalidate()
        pingTimer = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session?.invalidateAndCancel()
        session = nil
        resumeMusicIfNeeded()
        model.phase = .disconnected
        model.audioLevel = 0
        activationHandler = nil
        deactivationHandler = nil
        conversationWasActive = false
        started = false
    }

    // MARK: - User intents

    /// Orb click / menu item / hotkey: opens the notch on the Jarvis tab and
    /// toggles the conversation.
    func toggleConversation() {
        if model.phase.isConversationActive {
            send(["type": "endConversation"])
        } else {
            startConversation()
        }
    }

    /// Kept for call-site compatibility with the original bridge.
    func activateConversation() {
        startConversation()
    }

    func startConversation() {
        guard !model.phase.isConversationActive else { return }
        activationHandler?()
        send(["type": "startConversation"])
    }

    /// Focuses the Jarvis desktop app on the current conversation. The notch
    /// itself is an always-on-top panel, so closing it here is what actually
    /// makes the newly-focused desktop window visible — otherwise the app
    /// comes to front behind the still-open notch and it looks like nothing
    /// happened.
    func openJarvisApp() {
        send(["type": "openMainWindow"])
        deactivationHandler?()
    }

    /// Asks Jarvis to restart the notch (kill this process, spawn a fresh one
    /// with the current port/token). See notch.cjs's restartNotch — routed
    /// through Jarvis rather than self-relaunching because only Jarvis knows
    /// the live WS credentials.
    func restartNotch() {
        send(["type": "restartNotch"])
    }

    /// Called right before a user-initiated quit (the Quit menu item).
    /// Jarvis launches the notch via `open`, whose own exit status doesn't
    /// reflect how the launched app actually exited, so it can't tell "quit
    /// on purpose" from "crashed" just from that — this explicit signal is
    /// what makes the difference so Jarvis doesn't spend a minute trying to
    /// relaunch something you closed intentionally. Fire-and-forget over a
    /// loopback WebSocket is fast, but sending is asynchronous — callers
    /// must give it a brief moment (see the Quit button) before actually
    /// terminating, or the frame may never leave the process.
    func notifyUserQuit() {
        send(["type": "userQuit"])
    }

    func openJarvisSettings() {
        send(["type": "openSettings"])
    }

    /// Settings live in the Jarvis app (Settings → The Notch). The native
    /// settings window remains only as the offline fallback so the notch is
    /// never unconfigurable while Jarvis is closed.
    func openSettingsPreferringJarvis() {
        if model.phase == .disconnected {
            SettingsWindowController.shared.showWindow()
        } else {
            send(["type": "openSettings"])
        }
    }

    // MARK: - Connection

    private func connect() {
        guard started, let endpoint else {
            Logger.log("Jarvis bridge connect skipped: started=\(started), endpointPresent=\(endpoint != nil)", category: .network)
            return
        }
        var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(endpoint.port)/notch")!)
        request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
        let session = URLSession(configuration: .ephemeral)
        self.session = session
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        // Optimistic: a live socket means Jarvis is reachable, so drop the
        // offline styling immediately rather than waiting on the renderer to
        // broadcast its first "state" message (which only happens once the
        // chat view has mounted — leaving the UI stuck showing "Offline",
        // and intents like Open Jarvis silently blocked, until then).
        // handleDisconnect() corrects this back to .disconnected if the
        // connection actually fails.
        if model.phase == .disconnected {
            model.phase = .idle
        }
        Logger.log("Jarvis bridge connecting to 127.0.0.1:\(endpoint.port) tokenPresent=\(!endpoint.token.isEmpty)", category: .network)
        send(["type": "hello", "version": 1])
        sendSettingsSnapshot()
        receiveLoop(on: socket)
        schedulePings()
    }

    private func receiveLoop(on socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.socket === socket else { return }
                switch result {
                case .success(let message):
                    self.reconnectAttempt = 0
                    self.handle(message)
                    self.receiveLoop(on: socket)
                case .failure(let error):
                    Logger.log("Jarvis bridge receive failed: \(error.localizedDescription)", category: .error)
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleDisconnect() {
        guard started else { return }
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        pingTimer?.invalidate()
        pingTimer = nil
        model.phase = .disconnected
        model.audioLevel = 0
        resumeMusicIfNeeded()

        let delay = min(30.0, pow(2.0, Double(min(reconnectAttempt, 5))))
        reconnectAttempt += 1
        let workItem = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in self?.connect() }
        }
        reconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func schedulePings() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.socket?.sendPing { _ in }
            }
        }
    }

    private func send(_ payload: [String: Any]) {
        guard let socket else {
            let type = payload["type"] as? String ?? "unknown"
            Logger.log("Jarvis bridge dropped outbound \(type): socket is nil", category: .warning)
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8)
        else {
            let type = payload["type"] as? String ?? "unknown"
            Logger.log("Jarvis bridge dropped outbound \(type): JSON encoding failed", category: .error)
            return
        }
        socket.send(.string(text)) { _ in }
    }

    // MARK: - Inbound messages

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = payload["type"] as? String
        else { return }

        switch type {
        case "state":
            if let raw = payload["phase"] as? String, let phase = JarvisPhase(rawValue: raw) {
                applyPhase(phase)
            }
        case "audioLevel":
            if let level = payload["level"] as? Double {
                model.audioLevel = max(0, min(1, level))
            }
        case "transcript":
            if let turns = payload["turns"] as? [[String: Any]] {
                model.transcript = turns.compactMap { turn in
                    guard let id = turn["id"] as? String,
                          let rawRole = turn["role"] as? String,
                          let role = JarvisTranscriptTurn.Role(rawValue: rawRole),
                          let text = turn["text"] as? String
                    else { return nil }
                    return JarvisTranscriptTurn(
                        id: id,
                        role: role,
                        text: text,
                        isFinal: turn["final"] as? Bool ?? true
                    )
                }
            }
        case "toolActivity":
            if let activity = payload["activity"] as? [String: Any],
               let title = activity["title"] as? String,
               let statusRaw = activity["status"] as? String,
               let status = JarvisToolActivity.Status(rawValue: statusRaw)
            {
                model.toolActivity = JarvisToolActivity(
                    title: title,
                    subtitle: activity["subtitle"] as? String ?? "",
                    status: status
                )
            } else {
                model.toolActivity = nil
            }
        case "orbUrl":
            if let raw = payload["url"] as? String {
                model.orbURL = URL(string: raw)
            }
        case "startTimer":
            let duration = payload["durationSeconds"] as? Double
                ?? (payload["durationSeconds"] as? Int).map(Double.init)
                ?? 0
            let label = payload["label"] as? String ?? "Jarvis Timer"
            if duration > 0 {
                TimerManager.shared.adoptExternalTimer(
                    name: label,
                    totalDuration: duration,
                    remaining: duration,
                    isPaused: false,
                    playsLocalSound: true
                )
            } else {
                Logger.log("Ignoring startTimer with invalid duration: \(duration)", category: .warning)
            }
        case "conversationEnded":
            applyPhase(.idle)
        case "settingsRequest":
            sendSettingsSnapshot()
        case "settingsSet":
            if let key = payload["key"] as? String {
                applySetting(key: key, value: payload["value"])
            }
        case "settingsPermissionRequest":
            if let id = payload["id"] as? String {
                requestPermission(id: id)
            }
        default:
            Logger.log("Jarvis bridge received unhandled message type: \(type)", category: .debug)
        }
    }

    // MARK: - Settings sync

    private func sendSettingsSnapshot() {
        send([
            "snapshot": [
                "permissions": permissionSnapshot(),
                "values": settingsValues()
            ],
            "type": "settingsSnapshot"
        ])
    }

    private func settingsValues() -> [String: Any] {
        let defaults = UserDefaults.standard
        var values: [String: Any] = [:]

        for (key, defaultValue) in jarvisEditableNotchSettingDefaults {
            let raw = defaults.object(forKey: key) ?? defaultValue
            values[key] = jsonValue(raw, fallback: defaultValue)
        }

        return values
    }

    private func jsonValue(_ raw: Any, fallback: Any) -> Any {
        if let value = raw as? Bool { return value }
        if let value = raw as? Int { return value }
        if let value = raw as? Double { return value }
        if let value = raw as? Float { return Double(value) }
        if let value = raw as? CGFloat { return Double(value) }
        if let value = raw as? String { return value }
        if let number = raw as? NSNumber {
            if fallback is Bool { return number.boolValue }
            if fallback is Int { return number.intValue }
            return number.doubleValue
        }

        return fallback
    }

    private func applySetting(key: String, value: Any?) {
        guard let defaultValue = jarvisEditableNotchSettingDefaults[key] else { return }
        let defaults = UserDefaults.standard

        if defaultValue is Bool {
            if let boolValue = value as? Bool {
                defaults.set(boolValue, forKey: key)
            }
        } else if defaultValue is Int {
            if let intValue = value as? Int {
                defaults.set(intValue, forKey: key)
            } else if let doubleValue = value as? Double {
                defaults.set(Int(doubleValue), forKey: key)
            }
        } else if defaultValue is Double || defaultValue is CGFloat {
            if let doubleValue = value as? Double {
                defaults.set(doubleValue, forKey: key)
            } else if let intValue = value as? Int {
                defaults.set(Double(intValue), forKey: key)
            }
        } else if defaultValue is String, let stringValue = value as? String {
            defaults.set(stringValue, forKey: key)
        }

        defaults.synchronize()
        send([
            "snapshot": [
                "permissions": permissionSnapshot(),
                "values": settingsValues()
            ],
            "type": "settingsChanged"
        ])
    }

    private func permissionSnapshot() -> [[String: String]] {
        // Accessibility's `isAuthorized` is a stored value that only updates
        // via its own polling loop, which times out after ~15s — long enough
        // to go grant it in System Settings and come back after it's given
        // up. Refresh it here so every settings fetch reflects the real,
        // current OS status instead of whatever it was at launch.
        AccessibilityPermissionStore.shared.refreshStatus()

        return [
            permission(
                id: "accessibility",
                label: "Accessibility",
                status: AccessibilityPermissionStore.shared.isAuthorized ? "granted" : "unknown",
                description: "Required for hotkeys, media keys, system timer mirroring, and HUD control."
            ),
            permission(
                id: "fullDiskAccess",
                label: "Full Disk Access",
                status: FullDiskAccessAuthorization.hasPermission() ? "granted" : "unknown",
                description: "Required for Focus detection and some Shelf file workflows."
            ),
            permission(
                id: "filesAndFolders",
                label: "Files and Folders",
                status: ShelfFolderAccessAuthorization.hasDocumentsAndDownloadsAccess() ? "granted" : "unknown",
                description: "Allows Shelf access to Documents and Downloads."
            ),
            permission(
                id: "calendar",
                label: "Calendar & Reminders",
                status: calendarPermissionStatus(),
                description: "Powers calendar, reminders, sneak peeks, and lock screen widgets."
            ),
            permission(
                id: "camera",
                label: "Camera",
                status: avPermissionStatus(AVCaptureDevice.authorizationStatus(for: .video)),
                description: "Required for the notch mirror."
            ),
            permission(
                id: "microphone",
                label: "Microphone",
                status: avPermissionStatus(AVCaptureDevice.authorizationStatus(for: .audio)),
                description: "Used only by native privacy indicators; Jarvis voice runs in the desktop app."
            ),
            permission(
                id: "developerTools",
                label: "Developer Tools",
                status: "unknown",
                description: "Optional. Improves Focus detection without Full Disk Access."
            ),
            permission(
                id: "bluetooth",
                label: "Bluetooth",
                status: "unknown",
                description: "Optional. Lets the notch show Bluetooth audio device details."
            )
        ]
    }

    private func permission(id: String, label: String, status: String, description: String) -> [String: String] {
        [
            "description": description,
            "id": id,
            "label": label,
            "status": status
        ]
    }

    private func avPermissionStatus(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "granted"
        case .denied, .restricted:
            return "denied"
        case .notDetermined:
            return "unknown"
        @unknown default:
            return "unknown"
        }
    }

    private func calendarPermissionStatus() -> String {
        let event = EKEventStore.authorizationStatus(for: .event)
        let reminder = EKEventStore.authorizationStatus(for: .reminder)

        if isCalendarStatusGranted(event) && isCalendarStatusGranted(reminder) {
            return "granted"
        }
        if isCalendarStatusDenied(event) || isCalendarStatusDenied(reminder) {
            return "denied"
        }
        return "unknown"
    }

    private func isCalendarStatusGranted(_ status: EKAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .fullAccess, .writeOnly:
            return true
        default:
            return false
        }
    }

    private func isCalendarStatusDenied(_ status: EKAuthorizationStatus) -> Bool {
        switch status {
        case .denied, .restricted:
            return true
        default:
            return false
        }
    }

    private func requestPermission(id: String) {
        switch id {
        case "accessibility":
            AccessibilityPermissionStore.shared.requestAuthorizationPrompt()
        case "fullDiskAccess":
            FullDiskAccessPermissionStore.shared.requestAccessPrompt()
        case "filesAndFolders":
            ShelfFolderAccessPermissionStore.shared.requestAccessPrompt()
        case "calendar":
            Task { @MainActor in
                _ = await CalendarService().requestAccess()
                self.sendSettingsSnapshot()
            }
            return
        case "camera":
            WebcamManager.shared.checkAndRequestVideoAuthorization()
        case "microphone":
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] _ in
                Task { @MainActor [weak self] in self?.sendSettingsSnapshot() }
            }
            return
        case "developerTools":
            openSystemSettings([
                "x-apple.systempreferences:com.apple.preference.security?Privacy_DevTools",
                "x-apple.systempreferences:com.apple.preference.security"
            ])
        case "bluetooth":
            openSystemSettings([
                "x-apple.systempreferences:com.apple.BluetoothSettings",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth"
            ])
        default:
            break
        }

        sendSettingsSnapshot()
    }

    private func openSystemSettings(_ candidates: [String]) {
        for candidate in candidates {
            guard let url = URL(string: candidate) else { continue }
            if NSWorkspace.shared.open(url) {
                return
            }
        }
    }

    private func applyPhase(_ phase: JarvisPhase) {
        model.phase = phase
        if !phase.isConversationActive {
            model.audioLevel = 0
        }
        handlePhaseChange(phase)
    }

    // MARK: - Phase-driven behavior (kept from the original bridge)

    private func handlePhaseChange(_ phase: JarvisPhase) {
        if phase.isConversationActive {
            conversationWasActive = true
            pauseMusicIfNeeded()
            return
        }

        resumeMusicIfNeeded()

        if case .idle = phase, conversationWasActive {
            conversationWasActive = false
            deactivationHandler?()
        }
    }

    private func pauseMusicIfNeeded() {
        guard !musicPausedForConversation, MusicManager.shared.isPlaying else { return }
        MusicManager.shared.pause()
        musicPausedForConversation = true
        shouldResumeMusicWhenIdle = true
    }

    private func resumeMusicIfNeeded() {
        guard musicPausedForConversation else {
            shouldResumeMusicWhenIdle = false
            return
        }
        if shouldResumeMusicWhenIdle, !MusicManager.shared.isPlaying {
            MusicManager.shared.play()
        }
        musicPausedForConversation = false
        shouldResumeMusicWhenIdle = false
    }
}

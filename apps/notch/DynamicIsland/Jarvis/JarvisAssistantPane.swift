/*
 * Jarvis tab for the notch shell: orb on the left, live conversation
 * transcript on the right, plus a button that focuses the desktop app.
 */

import SwiftUI

struct JarvisAssistantPane: View {
    @ObservedObject private var model = JarvisAssistantBridge.shared.model

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            orbColumn
            transcriptColumn
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Orb (left)

    private var orbColumn: some View {
        VStack(spacing: 10) {
            Button {
                JarvisAssistantBridge.shared.toggleConversation()
            } label: {
                JarvisOrbView()
                    .frame(width: 118, height: 118)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help(model.phase.isConversationActive ? String(localized: "End conversation") : String(localized: "Talk to Jarvis"))

            HStack(spacing: 5) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)
                Text(model.phase.title)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.70))
                    .lineLimit(1)
            }
        }
        .frame(width: 132)
    }

    private var statusColor: Color {
        switch model.phase {
        case .disconnected: return .gray
        case .idle: return .cyan.opacity(0.7)
        case .listening, .transcribing: return .cyan
        case .thinking: return .indigo
        case .speaking: return .teal
        }
    }

    // MARK: - Transcript (right)

    private var transcriptColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.transcript.isEmpty {
                emptyState
            } else {
                transcriptScroll
            }

            if let activity = model.toolActivity {
                ToolActivityRow(activity: activity)
            }

            HStack {
                Spacer()
                Button {
                    JarvisAssistantBridge.shared.openJarvisApp()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.forward.app")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Open Jarvis")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.10), in: Capsule())
                    .overlay(Capsule().stroke(.white.opacity(0.12), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.92))
                .disabled(model.phase == .disconnected)
                .opacity(model.phase == .disconnected ? 0.45 : 1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Spacer(minLength: 0)
            Text(model.phase == .disconnected ? String(localized: "Jarvis is offline") : String(localized: "Click the orb to start talking"))
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
            Text(model.phase == .disconnected
                 ? String(localized: "Open the Jarvis app to bring the notch back online.")
                 : String(localized: "Your conversation will appear here."))
                .font(.system(size: 11, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(0.45))
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var transcriptScroll: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(model.transcript) { turn in
                        TranscriptBubble(turn: turn)
                            .id(turn.id)
                    }
                }
                .padding(.vertical, 2)
            }
            .onChange(of: model.transcript) { _, turns in
                guard let last = turns.last else { return }
                withAnimation(.smooth(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
            .onAppear {
                if let last = model.transcript.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }
}

private struct ToolActivityRow: View {
    let activity: JarvisToolActivity

    private var iconName: String {
        switch activity.status {
        case .running: return "arrow.triangle.2.circlepath"
        case .error: return "exclamationmark.triangle"
        case .warning: return "exclamationmark.circle"
        case .success: return "checkmark.circle"
        }
    }

    private var color: Color {
        switch activity.status {
        case .running: return .cyan
        case .error: return .red
        case .warning: return .yellow
        case .success: return .green
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: iconName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(color.opacity(0.9))

            VStack(alignment: .leading, spacing: 2) {
                Text(activity.title)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(1)
                if !activity.subtitle.isEmpty {
                    Text(activity.subtitle)
                        .font(.system(size: 10, weight: .regular, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        )
    }
}

private struct TranscriptBubble: View {
    let turn: JarvisTranscriptTurn

    private var isUser: Bool { turn.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 24) }
            Text(turn.text)
                .font(.system(size: 12, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(isUser ? 0.92 : 0.85))
                .multilineTextAlignment(.leading)
                .textSelection(.enabled)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    isUser ? AnyShapeStyle(.white.opacity(0.13)) : AnyShapeStyle(.white.opacity(0.055)),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .opacity(turn.isFinal ? 1 : 0.7)
            if !isUser { Spacer(minLength: 24) }
        }
    }
}

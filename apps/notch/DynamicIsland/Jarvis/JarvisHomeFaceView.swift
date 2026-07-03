/*
 * Jarvis home panel for the notch: just the orb.
 * Click toggles talking mode (flips the notch to the Jarvis tab).
 */

import SwiftUI

struct JarvisHomeFaceView: View {
    @ObservedObject private var model = JarvisAssistantBridge.shared.model
    @State private var isHovering = false

    var body: some View {
        Button {
            JarvisAssistantBridge.shared.toggleConversation()
        } label: {
            // Fixed 118pt: the home card is short, so an aspect-fit fill
            // shrinks the orb to the card height instead of growing it.
            JarvisOrbView()
                .frame(width: 118, height: 118)
                .scaleEffect(isHovering ? 1.05 : 1.0)
                .animation(.smooth(duration: 0.2), value: isHovering)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(model.phase.isConversationActive ? String(localized: "End conversation") : String(localized: "Talk to Jarvis"))
    }
}

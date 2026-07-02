/*
 * Renders the Jarvis orb inside the notch.
 *
 * When the desktop app is connected it serves the real Three.js orb page and
 * this view embeds it in a WKWebView (transparent over the notch black).
 * While disconnected — or before the page loads — a native glow stands in so
 * the notch never shows a blank hole.
 */

import SwiftUI
import WebKit

struct JarvisOrbView: View {
    @ObservedObject private var model = JarvisAssistantBridge.shared.model

    var body: some View {
        ZStack {
            NativeOrbGlow(phase: model.phase, level: model.audioLevel)
            if let url = model.orbURL {
                OrbWebView(url: url)
                    .allowsHitTesting(false)
            }
        }
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// Shared process pool so the home tab, assistant pane, and live activity orbs
/// stay one web content process.
private enum OrbWebViewPool {
    static let processPool = WKProcessPool()
}

private struct OrbWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.processPool = OrbWebViewPool.processPool
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }
}

/// Native stand-in: a soft cyan orb whose glow breathes with the live audio
/// level and dims when Jarvis is offline.
private struct NativeOrbGlow: View {
    let phase: JarvisPhase
    let level: Double

    private var isOffline: Bool { phase == .disconnected }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let pulse = 0.72 + 0.28 * level

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                baseColor.opacity(isOffline ? 0.25 : 0.85),
                                baseColor.opacity(isOffline ? 0.10 : 0.35),
                                .clear,
                            ],
                            center: .center,
                            startRadius: side * 0.05,
                            endRadius: side * 0.5
                        )
                    )
                    .scaleEffect(pulse)

                Circle()
                    .stroke(baseColor.opacity(isOffline ? 0.18 : 0.55), lineWidth: 1)
                    .scaleEffect(0.62 * pulse)
                    .blur(radius: 0.4)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.smooth(duration: 0.18), value: level)
            .animation(.smooth(duration: 0.4), value: phase)
        }
    }

    private var baseColor: Color {
        switch phase {
        case .disconnected: return Color(white: 0.65)
        case .idle: return .cyan
        case .listening, .transcribing: return .cyan
        case .thinking: return .indigo
        case .speaking: return .teal
        }
    }
}

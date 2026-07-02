/*
 * Atoll (DynamicIsland)
 * Copyright (C) 2024-2026 Atoll Contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import Foundation
import SwiftUI
import Combine
import Defaults

// MARK: - Indicator Layout Enum
enum IndicatorLayout {
    case none
    case cameraOnly
    case microphoneOnly
    case cameraAndMicrophone
    
    // Computed properties for UI positioning
    var showsRecordingPulsator: Bool {
        false
    }
    
    var showsCameraIndicator: Bool {
        switch self {
        case .cameraOnly, .cameraAndMicrophone:
            return true
        default:
            return false
        }
    }
    
    var showsMicrophoneIndicator: Bool {
        switch self {
        case .microphoneOnly, .cameraAndMicrophone:
            return true
        default:
            return false
        }
    }
    
    // Description for debugging
    var description: String {
        switch self {
        case .none: return "None"
        case .cameraOnly: return "Camera Only"
        case .microphoneOnly: return "Microphone Only"
        case .cameraAndMicrophone: return "Camera + Microphone"
        }
    }
}

// MARK: - Privacy Indicator Manager
@MainActor
class PrivacyIndicatorManager: ObservableObject {
    // MARK: - Singleton
    static let shared = PrivacyIndicatorManager()
    
    // MARK: - Published Properties
    @Published var cameraActive: Bool = false
    @Published var microphoneActive: Bool = false
    @Published var isMonitoring: Bool = false
    
    // MARK: - Child Monitors
    private let cameraMonitor = CameraMonitor()
    private let microphoneMonitor = MicrophoneMonitor()
    
    // MARK: - Cancellables
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Computed Properties
    
    /// Current indicator layout based on active states
    var indicatorLayout: IndicatorLayout {
        // Respect user settings
        let camera = cameraActive && Defaults[.enableCameraDetection]
        let mic = microphoneActive && Defaults[.enableMicrophoneDetection]
        switch (camera, mic) {
        case (false, false):
            return .none
        case (true, false):
            return .cameraOnly
        case (false, true):
            return .microphoneOnly
        case (true, true):
            return .cameraAndMicrophone
        }
    }
    
    /// Check if any indicator is active (respecting user settings)
    var hasAnyIndicator: Bool {
        let showCamera = cameraActive && Defaults[.enableCameraDetection]
        let showMic = microphoneActive && Defaults[.enableMicrophoneDetection]
        return showCamera || showMic
    }
    
    // MARK: - Initialization
    private init() {
        print("PrivacyIndicatorManager: 🚀 Initializing...")
        setupBindings()
    }
    
    // MARK: - Setup Methods
    
    /// Setup bindings to child monitors
    private func setupBindings() {
        // Bind camera monitor
        cameraMonitor.$isCameraActive
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isActive in
                guard let self = self else { return }
                if self.cameraActive != isActive {
                    print("PrivacyIndicatorManager: 📷 Camera state: \(isActive)")
                    withAnimation(.smooth) {
                        self.cameraActive = isActive
                    }
                    self.logLayoutChange()
                }
            }
            .store(in: &cancellables)
        
        // Bind microphone monitor
        microphoneMonitor.$isMicActive
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isActive in
                guard let self = self else { return }
                if self.microphoneActive != isActive {
                    print("PrivacyIndicatorManager: 🎤 Microphone state: \(isActive)")
                    withAnimation(.smooth) {
                        self.microphoneActive = isActive
                    }
                    self.logLayoutChange()
                }
            }
            .store(in: &cancellables)
        
    }
    
    /// Log layout changes for debugging
    private func logLayoutChange() {
        print("PrivacyIndicatorManager: 🔄 Layout changed to: \(indicatorLayout.description)")
        print("PrivacyIndicatorManager: 📊 States - Camera: \(cameraActive), Mic: \(microphoneActive)")
    }
    
    // MARK: - Public Methods
    
    /// Start monitoring all privacy indicators
    func startMonitoring() {
        print("PrivacyIndicatorManager: 🟢 Starting all monitors...")
        
        isMonitoring = true
        
        // Start camera monitoring
        if cameraMonitor.isMonitoringAvailable {
            cameraMonitor.startMonitoring()
        } else {
            print("PrivacyIndicatorManager: ⚠️ Camera monitoring not available")
        }
        
        // Start microphone monitoring
        if microphoneMonitor.isMonitoringAvailable {
            microphoneMonitor.startMonitoring()
        } else {
            print("PrivacyIndicatorManager: ⚠️ Microphone monitoring not available")
        }
        
        print("PrivacyIndicatorManager: ✅ All monitors started")
    }
    
    /// Stop monitoring all privacy indicators
    func stopMonitoring() {
        print("PrivacyIndicatorManager: 🛑 Stopping all monitors...")
        
        isMonitoring = false
        
        cameraMonitor.stopMonitoring()
        microphoneMonitor.stopMonitoring()
        
        print("PrivacyIndicatorManager: ✅ All monitors stopped")
    }
    
    /// Toggle monitoring state
    func toggleMonitoring() {
        if cameraMonitor.isMonitoring || microphoneMonitor.isMonitoring {
            stopMonitoring()
        } else {
            startMonitoring()
        }
    }
    
    /// Get detailed status string for debugging
    func getStatusString() -> String {
        var status = "Privacy Indicators:\n"
        status += "  Camera: \(cameraActive ? "🟢 Active" : "⚪ Inactive")\n"
        status += "  Microphone: \(microphoneActive ? "🟢 Active" : "⚪ Inactive")\n"
        status += "  Layout: \(indicatorLayout.description)"
        return status
    }
}

// MARK: - Extensions

extension PrivacyIndicatorManager {
    /// Get camera monitor instance
    var camera: CameraMonitor {
        return cameraMonitor
    }
    
    /// Get microphone monitor instance
    var microphone: MicrophoneMonitor {
        return microphoneMonitor
    }
}

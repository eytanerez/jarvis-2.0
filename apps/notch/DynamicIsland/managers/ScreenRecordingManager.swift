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

import Combine
import Foundation

@MainActor
class ScreenRecordingManager: ObservableObject {
    static let shared = ScreenRecordingManager()

    @Published var isRecording: Bool = false
    @Published var isMonitoring: Bool = false
    @Published var recordingDuration: TimeInterval = 0
    @Published var isRecorderIdle: Bool = true
    @Published var lastUpdated: Date = .distantPast

    private init() {}

    func startMonitoring() {
        stopMonitoring()
    }

    func stopMonitoring() {
        isMonitoring = false
        isRecording = false
        recordingDuration = 0
        isRecorderIdle = true
        lastUpdated = .distantPast
    }

    func toggleMonitoring() {
        stopMonitoring()
    }

    func checkRecordingStatus() {
        stopMonitoring()
    }
}

extension ScreenRecordingManager {
    var currentRecordingStatus: Bool {
        false
    }

    var isMonitoringAvailable: Bool {
        false
    }

    var formattedDuration: String {
        "0:00"
    }
}

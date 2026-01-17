import Foundation

class OutputStreamer {
    private var sequenceNumber = 0
    private let encoder: JSONEncoder

    init() {
        encoder = JSONEncoder()
        encoder.outputFormatting = [] // Compact JSON, no pretty printing
    }

    func streamUpdate(appName: String, appPID: Int32, textBoxes: [TextBoxInfo], isPaused: Bool = false) {
        let update = MonitorUpdate(
            timestamp: Date().timeIntervalSince1970 * 1000, // milliseconds
            sequenceNumber: sequenceNumber,
            appName: appName,
            appPID: appPID,
            textBoxes: textBoxes,
            error: nil,
            isPaused: isPaused
        )

        sequenceNumber += 1
        outputJSON(update)
    }

    func streamError(_ error: String, appName: String = "", appPID: Int32 = 0) {
        let update = MonitorUpdate(
            timestamp: Date().timeIntervalSince1970 * 1000,
            sequenceNumber: sequenceNumber,
            appName: appName,
            appPID: appPID,
            textBoxes: [],
            error: error,
            isPaused: false
        )

        sequenceNumber += 1
        outputJSON(update)
    }

    private func outputJSON(_ update: MonitorUpdate) {
        do {
            let data = try encoder.encode(update)
            if let jsonString = String(data: data, encoding: .utf8) {
                print(jsonString)
                fflush(stdout) // Ensure immediate output
            }
        } catch {
            // Fallback error output
            fputs("{\"error\":\"JSON encoding failed: \(error.localizedDescription)\"}\n", stderr)
        }
    }
}

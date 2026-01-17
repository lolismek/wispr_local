import Foundation

// MARK: - Text Box Information

struct TextBoxInfo: Codable {
    let role: String
    let position: Position
    let size: Size
    let value: String?
    let label: String?
    let placeholder: String?
    let identifier: String?
    let description: String?
    let isFocused: Bool
    let isEnabled: Bool
}

struct Position: Codable {
    let x: Double
    let y: Double
}

struct Size: Codable {
    let width: Double
    let height: Double
}

// MARK: - Monitor Update

struct MonitorUpdate: Codable {
    let timestamp: Double
    let sequenceNumber: Int
    let appName: String
    let appPID: Int32
    let textBoxes: [TextBoxInfo]
    let error: String?
    let isPaused: Bool
}

// MARK: - Monitor Configuration

struct MonitorConfig {
    var refreshInterval: TimeInterval = 0.5 // 500ms
    var maxDepth: Int = 10
    var electronPID: Int32? = nil
}

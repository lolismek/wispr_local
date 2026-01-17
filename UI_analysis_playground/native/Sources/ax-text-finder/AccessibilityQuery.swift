import ApplicationServices
import Foundation

class AccessibilityQuery {
    private let maxDepth: Int

    init(maxDepth: Int = 10) {
        self.maxDepth = maxDepth
    }

    // MARK: - Public API

    func queryTextBoxes(pid: pid_t) -> [TextBoxInfo] {
        let appElement = AXUIElementCreateApplication(pid)
        var textBoxes: [TextBoxInfo] = []

        traverseUIHierarchy(element: appElement, depth: 0, textBoxes: &textBoxes)

        return textBoxes
    }

    // MARK: - UI Hierarchy Traversal (Breadth-First)

    private func traverseUIHierarchy(element: AXUIElement, depth: Int, textBoxes: inout [TextBoxInfo]) {
        guard depth < maxDepth else { return }

        // Check if this element is a text box
        if let textBox = extractTextBoxInfo(from: element) {
            textBoxes.append(textBox)
        }

        // Get children and traverse
        guard let children = getAttributeValue(element: element, attribute: kAXChildrenAttribute) as? [AXUIElement] else {
            return
        }

        for child in children {
            traverseUIHierarchy(element: child, depth: depth + 1, textBoxes: &textBoxes)
        }
    }

    // MARK: - Text Box Detection and Extraction

    private func extractTextBoxInfo(from element: AXUIElement) -> TextBoxInfo? {
        guard let role = getAttributeValue(element: element, attribute: kAXRoleAttribute) as? String else {
            return nil
        }

        // Filter for text input elements
        let textBoxRoles = [
            kAXTextFieldRole as String,
            kAXTextAreaRole as String,
            kAXComboBoxRole as String,
            "AXSearchField" // Search field role
        ]

        guard textBoxRoles.contains(role) else {
            return nil
        }

        // Extract position
        var positionValue: CFTypeRef?
        let positionResult = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
        var position = Position(x: 0, y: 0)
        if positionResult == .success, let positionRef = positionValue {
            var point = CGPoint.zero
            if AXValueGetValue(positionRef as! AXValue, .cgPoint, &point) {
                position = Position(x: Double(point.x), y: Double(point.y))
            }
        }

        // Extract size
        var sizeValue: CFTypeRef?
        let sizeResult = AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue)
        var size = Size(width: 0, height: 0)
        if sizeResult == .success, let sizeRef = sizeValue {
            var cgSize = CGSize.zero
            if AXValueGetValue(sizeRef as! AXValue, .cgSize, &cgSize) {
                size = Size(width: Double(cgSize.width), height: Double(cgSize.height))
            }
        }

        // Extract other attributes
        let value = getAttributeValue(element: element, attribute: kAXValueAttribute) as? String
        let label = getAttributeValue(element: element, attribute: kAXTitleAttribute) as? String
            ?? getAttributeValue(element: element, attribute: kAXDescriptionAttribute) as? String
        let placeholder = getAttributeValue(element: element, attribute: kAXPlaceholderValueAttribute) as? String
        let identifier = getAttributeValue(element: element, attribute: kAXIdentifierAttribute) as? String
        let description = getAttributeValue(element: element, attribute: kAXDescriptionAttribute) as? String
        let isFocused = getAttributeValue(element: element, attribute: kAXFocusedAttribute) as? Bool ?? false
        let isEnabled = getAttributeValue(element: element, attribute: kAXEnabledAttribute) as? Bool ?? true

        // Check if the text box is editable/writable
        // Strategy: Check if the value attribute is settable, OR if the role indicates an editable field
        var isSettable: DarwinBoolean = false
        let settableResult = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &isSettable)
        let isValueSettable = (settableResult == .success && isSettable.boolValue)

        // TextFields and TextAreas are typically editable by their nature
        // ComboBoxes might not report as settable but are still editable
        let hasEditableRole = [
            kAXTextFieldRole as String,
            kAXTextAreaRole as String,
            kAXComboBoxRole as String
        ].contains(role)

        // Include if: (settable check passed) OR (has editable role AND is enabled)
        // This handles both native apps and web content in Safari
        let isEditable = isValueSettable || (hasEditableRole && isEnabled)

        // Filter out read-only text boxes
        guard isEditable else {
            return nil
        }

        return TextBoxInfo(
            role: role,
            position: position,
            size: size,
            value: value,
            label: label,
            placeholder: placeholder,
            identifier: identifier,
            description: description,
            isFocused: isFocused,
            isEnabled: isEnabled
        )
    }

    // MARK: - Attribute Helper

    private func getAttributeValue(element: AXUIElement, attribute: String) -> Any? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else {
            return nil
        }

        return value
    }
}

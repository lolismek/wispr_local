// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "ax-text-finder",
    platforms: [
        .macOS(.v12)
    ],
    targets: [
        .executableTarget(
            name: "ax-text-finder",
            path: "Sources/ax-text-finder"
        )
    ]
)

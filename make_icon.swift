// Малює іконку 1024×1024 з літерою «І» і зберігає в icon.png
import AppKit

let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Заокруглений квадрат із синім градієнтом (як стандартні іконки macOS)
let inset: CGFloat = 100
let rect = NSRect(x: inset, y: inset, width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset)
let shape = NSBezierPath(roundedRect: rect, xRadius: 185, yRadius: 185)
NSGradient(starting: NSColor(red: 0.30, green: 0.56, blue: 1.0, alpha: 1),
           ending: NSColor(red: 0.12, green: 0.25, blue: 0.75, alpha: 1))!.draw(in: shape, angle: -90)

// Літера «І»
let text = NSAttributedString(string: "І", attributes: [
    .font: NSFont.systemFont(ofSize: 620, weight: .heavy),
    .foregroundColor: NSColor.white])
let t = text.size()
text.draw(at: NSPoint(x: (CGFloat(size) - t.width) / 2, y: (CGFloat(size) - t.height) / 2))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "icon.png"))

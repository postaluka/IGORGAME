// Гра «ІГОР»: влучи мишкою по літерах, що літають у біт музики, у правильному порядку.
import AppKit
import AVFoundation

let word = ["І", "Г", "О", "Р"]
// Зайві літери, з яких щораунду випадково беруться обманки
let decoyPool = ["А", "Б", "В", "Д", "Е", "Ж", "З", "И", "К", "Л", "М", "Н", "П", "С", "Т", "У", "Ф", "Х", "Ш", "Я", "Ї", "Є"]

// Розмір вікна 1000×672 — як у картинки фону (1024×688), щоб нічого не розтягувалось
let winW: CGFloat = 1000, winH: CGFloat = 672
let topH: CGFloat = 110, bottomH: CGFloat = 90
let fieldH = winH - topH - bottomH
let keySize: CGFloat = 72

struct Level {
    let name: String
    let speed: CGFloat      // пікселів за секунду
    let decoys: Int         // скільки зайвих літер
}
let levels = [
    Level(name: "Легко", speed: 70, decoys: 4),
    Level(name: "Нормально", speed: 140, decoys: 6),
    Level(name: "Важко", speed: 230, decoys: 8),
    Level(name: "Пекло 🔥", speed: 340, decoys: 10),
]

func label(_ text: String, size: CGFloat, color: NSColor = .white) -> NSTextField {
    let l = NSTextField(labelWithString: text)
    l.font = .boldSystemFont(ofSize: size)
    l.textColor = color
    l.alignment = .center
    l.shadow = { let s = NSShadow(); s.shadowColor = .black; s.shadowBlurRadius = 6; return s }()
    return l
}

func bigButton(_ title: String, color: NSColor, target: AnyObject, action: Selector) -> NSButton {
    let b = NSButton(title: title, target: target, action: action)
    b.isBordered = false
    b.wantsLayer = true
    b.layer?.cornerRadius = 14
    b.layer?.backgroundColor = color.cgColor
    b.attributedTitle = NSAttributedString(string: title, attributes: [
        .font: NSFont.boldSystemFont(ofSize: 24), .foregroundColor: NSColor.white])
    return b
}

/// Літера, що літає. Ловить натискання одразу (mouseDown), щоб по рухомій цілі було реально влучити.
final class LetterView: NSView {
    let letter: String
    var velocity = CGVector.zero
    var boost: CGFloat = 1          // ривок у біт, поступово згасає
    var used = false
    var onHit: ((LetterView) -> Void)?
    private let text: NSTextField

    init(_ letter: String) {
        self.letter = letter
        text = label(letter, size: 34)
        super.init(frame: NSRect(x: 0, y: 0, width: keySize, height: keySize))
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.borderWidth = 2
        layer?.borderColor = NSColor.white.withAlphaComponent(0.7).cgColor
        layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.85).cgColor
        text.frame = NSRect(x: 0, y: (keySize - 44) / 2, width: keySize, height: 44)
        addSubview(text)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { if !used { onHit?(self) } }

    func markUsed() {
        used = true
        layer?.backgroundColor = NSColor.systemGray.withAlphaComponent(0.85).cgColor
        text.textColor = NSColor.white.withAlphaComponent(0.5)
    }

    /// Спалах на удар барабана
    func flash() {
        guard !used else { return }
        layer?.backgroundColor = NSColor.systemOrange.cgColor
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            guard let self, !self.used else { return }
            self.layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.85).cgColor
        }
    }
}

final class Game: NSObject {
    let window: NSWindow
    let menu = NSView(frame: NSRect(x: 0, y: 0, width: winW, height: winH))
    let play = NSView(frame: NSRect(x: 0, y: 0, width: winW, height: winH))
    let field = NSView(frame: NSRect(x: 0, y: bottomH, width: winW, height: fieldH))
    let typedLabel = label("", size: 38, color: .systemYellow)
    let statusLabel = label("", size: 22)
    let levelInfo = label("", size: 16, color: NSColor.white.withAlphaComponent(0.8))
    let levelPicker = NSSegmentedControl(labels: levels.map { $0.name }, trackingMode: .selectOne, target: nil, action: nil)

    var level = levels[1]
    var keys: [LetterView] = []
    var typed: [String] = []
    var over = false

    var player: AVAudioPlayer?
    var timer: Timer?
    var lastTick = Date()
    var avgLevel: Float = 0
    var lastBeat = Date.distantPast

    override init() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: winW, height: winH),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        super.init()
        window.title = "Гра ІГОР"
        window.appearance = NSAppearance(named: .darkAqua)  // світлий текст у перемикачі рівнів
        let content = window.contentView!
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.black.cgColor

        // Фон: скелет-рицар з гітарою
        if let url = Bundle.main.url(forResource: "background", withExtension: "png"),
           let img = NSImage(contentsOf: url) {
            let bg = NSImageView(frame: content.bounds)
            bg.image = img
            bg.imageScaling = .scaleAxesIndependently
            content.addSubview(bg)
        }

        // Музика: грає по колу, з вимірюванням гучності для біту
        if let url = Bundle.main.url(forResource: "music", withExtension: "mp3") {
            player = try? AVAudioPlayer(contentsOf: url)
            player?.numberOfLoops = -1
            player?.isMeteringEnabled = true
            player?.volume = 0.8
            player?.play()
        }

        buildMenu()
        buildPlay()
        content.addSubview(menu)
        content.addSubview(play)
        showMenu()

        // Один таймер на все: рух літер і пошук біту
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)

        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: - Екрани

    func shade(_ r: NSRect, alpha: CGFloat = 0.55) -> NSView {
        let v = NSView(frame: r)
        v.wantsLayer = true
        v.layer?.backgroundColor = NSColor.black.withAlphaComponent(alpha).cgColor
        return v
    }

    func buildMenu() {
        let panelW: CGFloat = 520, panelH: CGFloat = 400
        let panel = shade(NSRect(x: (winW - panelW) / 2, y: (winH - panelH) / 2, width: panelW, height: panelH), alpha: 0.65)
        panel.layer?.cornerRadius = 24
        menu.addSubview(panel)

        let title = label("ІГОР", size: 72, color: .systemYellow)
        title.frame = NSRect(x: 0, y: panelH - 110, width: panelW, height: 90)
        panel.addSubview(title)

        let sub = label("Влуч мишкою по літерах у правильному порядку!", size: 16)
        sub.frame = NSRect(x: 0, y: panelH - 140, width: panelW, height: 24)
        panel.addSubview(sub)

        let lvl = label("Рівень складності", size: 18)
        lvl.frame = NSRect(x: 0, y: 210, width: panelW, height: 26)
        panel.addSubview(lvl)

        levelPicker.selectedSegment = 1
        levelPicker.controlSize = .large
        levelPicker.sizeToFit()
        levelPicker.frame.origin = NSPoint(x: (panelW - levelPicker.frame.width) / 2, y: 172)
        panel.addSubview(levelPicker)

        let start = bigButton("Старт", color: .systemGreen, target: self, action: #selector(startGame))
        start.keyEquivalent = "\r"
        start.frame = NSRect(x: (panelW - 240) / 2, y: 95, width: 240, height: 56)
        panel.addSubview(start)

        let exit = bigButton("Exit", color: .systemRed, target: self, action: #selector(exitGame))
        exit.frame = NSRect(x: (panelW - 240) / 2, y: 28, width: 240, height: 50)
        panel.addSubview(exit)
    }

    func buildPlay() {
        play.addSubview(shade(NSRect(x: 0, y: winH - topH, width: winW, height: topH)))
        play.addSubview(shade(NSRect(x: 0, y: 0, width: winW, height: bottomH)))

        let title = label("Напиши ІГОР!", size: 26)
        title.frame = NSRect(x: 0, y: winH - 44, width: winW, height: 34)
        play.addSubview(title)

        levelInfo.frame = NSRect(x: winW - 220, y: winH - 40, width: 200, height: 24)
        levelInfo.alignment = .right
        play.addSubview(levelInfo)

        typedLabel.frame = NSRect(x: 0, y: winH - topH + 8, width: winW, height: 50)
        play.addSubview(typedLabel)

        play.addSubview(field)

        statusLabel.frame = NSRect(x: 0, y: 52, width: winW, height: 30)
        play.addSubview(statusLabel)

        let again = bigButton("Ще раз", color: .systemGreen, target: self, action: #selector(newRound))
        again.attributedTitle = NSAttributedString(string: "Ще раз", attributes: [
            .font: NSFont.boldSystemFont(ofSize: 18), .foregroundColor: NSColor.white])
        again.keyEquivalent = "\r"
        again.frame = NSRect(x: winW / 2 - 130, y: 10, width: 120, height: 38)
        play.addSubview(again)

        let toMenu = bigButton("Меню", color: .systemIndigo, target: self, action: #selector(showMenu))
        toMenu.attributedTitle = NSAttributedString(string: "Меню", attributes: [
            .font: NSFont.boldSystemFont(ofSize: 18), .foregroundColor: NSColor.white])
        toMenu.keyEquivalent = "\u{1b}"   // Esc
        toMenu.frame = NSRect(x: winW / 2 + 10, y: 10, width: 120, height: 38)
        play.addSubview(toMenu)
    }

    @objc func showMenu() {
        menu.isHidden = false
        play.isHidden = true
    }

    @objc func startGame() {
        level = levels[max(0, levelPicker.selectedSegment)]
        levelInfo.stringValue = "Рівень: \(level.name)"
        menu.isHidden = true
        play.isHidden = false
        newRound()
    }

    @objc func exitGame() { NSApp.terminate(nil) }

    // MARK: - Гра

    @objc func newRound() {
        typed = []
        over = false
        statusLabel.stringValue = ""
        updateTyped()

        keys.forEach { $0.removeFromSuperview() }
        let letters = (word + decoyPool.shuffled().prefix(level.decoys)).shuffled()
        keys = letters.map { l in
            let v = LetterView(l)
            v.onHit = { [weak self] v in self?.press(v) }
            return v
        }
        for (k, p) in zip(keys, randomSpots(keys.count)) {
            k.setFrameOrigin(p)
            k.velocity = randomVelocity()
            field.addSubview(k)
        }
    }

    func randomVelocity() -> CGVector {
        let a = CGFloat.random(in: 0..<(2 * .pi))
        return CGVector(dx: cos(a) * level.speed, dy: sin(a) * level.speed)
    }

    /// Випадкові місця для клавіш, щоб вони не накладались на старті.
    func randomSpots(_ n: Int) -> [NSPoint] {
        var spots: [NSPoint] = []
        var tries = 0
        while spots.count < n {
            tries += 1
            let gap: CGFloat = tries > 5000 ? 4 : 20
            let p = NSPoint(x: .random(in: 10...(winW - keySize - 10)),
                            y: .random(in: 10...(fieldH - keySize - 10)))
            if spots.allSatisfy({ abs($0.x - p.x) > keySize + gap || abs($0.y - p.y) > keySize + gap }) {
                spots.append(p)
            }
        }
        return spots
    }

    func press(_ k: LetterView) {
        guard !over else { return }
        k.markUsed()
        typed.append(k.letter)
        updateTyped()

        if typed.count == word.count {
            over = true
            if typed == word {
                statusLabel.stringValue = "🎉 Ти виграв!"
                statusLabel.textColor = .systemGreen
            } else {
                statusLabel.stringValue = "💥 Ти програв! Вийшло «\(typed.joined())»"
                statusLabel.textColor = .systemRed
            }
        }
    }

    func updateTyped() {
        typedLabel.stringValue = (0..<word.count)
            .map { $0 < typed.count ? typed[$0] : "_" }
            .joined(separator: " ")
    }

    // MARK: - Рух і біт

    /// Шукає удар барабана: гучність різко вища за середню.
    func detectBeat() -> Bool {
        guard let p = player, p.isPlaying else { return false }
        p.updateMeters()
        let db = (p.averagePower(forChannel: 0) + p.averagePower(forChannel: min(1, p.numberOfChannels - 1))) / 2
        let lvl = powf(10, db / 20)
        defer { avgLevel = avgLevel * 0.93 + lvl * 0.07 }
        if lvl > avgLevel * 1.35 && lvl > 0.02 && Date().timeIntervalSince(lastBeat) > 0.25 {
            lastBeat = Date()
            return true
        }
        return false
    }

    func tick() {
        let now = Date()
        let dt = CGFloat(min(now.timeIntervalSince(lastTick), 0.05))
        lastTick = now

        let beat = detectBeat()
        guard !play.isHidden else { return }

        for k in keys {
            if beat {
                // На удар: літера смикається в новий бік і на мить пришвидшується
                k.velocity = randomVelocity()
                k.boost = 2.6
                k.flash()
            }
            k.boost = max(1, k.boost - 4 * dt)

            var o = k.frame.origin
            o.x += k.velocity.dx * k.boost * dt
            o.y += k.velocity.dy * k.boost * dt
            // Відскок від стінок
            if o.x < 0 { o.x = 0; k.velocity.dx = abs(k.velocity.dx) }
            if o.x > winW - keySize { o.x = winW - keySize; k.velocity.dx = -abs(k.velocity.dx) }
            if o.y < 0 { o.y = 0; k.velocity.dy = abs(k.velocity.dy) }
            if o.y > fieldH - keySize { o.y = fieldH - keySize; k.velocity.dy = -abs(k.velocity.dy) }
            k.setFrameOrigin(o)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var game: Game?
    func applicationDidFinishLaunching(_ n: Notification) {
        game = Game()
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()

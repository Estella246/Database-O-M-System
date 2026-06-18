#!/usr/bin/swift
import AppKit
import CoreGraphics

let base = URL(fileURLWithPath: CommandLine.arguments[1])
let srcName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "favicon-src.png"
let srcURL = base.appendingPathComponent(srcName)

guard let nsImage = NSImage(contentsOf: srcURL),
      let cgFull = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    fputs("failed to load \(srcURL.path)\n", stderr)
    exit(1)
}

let width = cgFull.width
let height = cgFull.height
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bytesPerPixel = 4
let bytesPerRow = bytesPerPixel * width
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

guard let ctx = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fputs("failed to create context\n", stderr)
    exit(1)
}

ctx.draw(cgFull, in: CGRect(x: 0, y: 0, width: width, height: height))
guard let data = ctx.data else { exit(1) }
let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * bytesPerPixel)

func isContent(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> Bool {
    let lum = (Int(r) + Int(g) + Int(b)) / 3
    return lum > 18
}

var minX = width, minY = height, maxX = 0, maxY = 0
for y in 0..<height {
    for x in 0..<width {
        let i = (y * width + x) * bytesPerPixel
        let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
        if isContent(r, g, b) {
            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
        }
    }
}

if maxX <= minX || maxY <= minY {
    fputs("no content bounds found\n", stderr)
    exit(1)
}

let pad = Int(Double(max(maxX - minX, maxY - minY)) * 0.06)
minX = max(0, minX - pad)
minY = max(0, minY - pad)
maxX = min(width - 1, maxX + pad)
maxY = min(height - 1, maxY + pad)

let cropW = maxX - minX + 1
let cropH = maxY - minY + 1
let side = max(cropW, cropH)
let squareX = minX - max(0, (side - cropW) / 2)
let squareY = minY - max(0, (side - cropH) / 2)
let clampedX = max(0, min(squareX, width - side))
let clampedY = max(0, min(squareY, height - side))
let clampedSide = min(side, min(width - clampedX, height - clampedY))

guard let cropped = cgFull.cropping(to: CGRect(
    x: clampedX,
    y: clampedY,
    width: clampedSide,
    height: clampedSide
)) else {
    fputs("failed to crop\n", stderr)
    exit(1)
}

func writePNG(_ cgImage: CGImage, name: String, size: Int) {
    let outURL = base.appendingPathComponent(name)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ), let scaled = {
        ctx.interpolationQuality = .high
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: size, height: size))
        return ctx.makeImage()
    }() else {
        fputs("failed to scale \(name)\n", stderr)
        exit(1)
    }

    let rep = NSBitmapImageRep(cgImage: scaled)
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try! png.write(to: outURL)
    print("wrote \(outURL.lastPathComponent) \(size)x\(size)")
}

writePNG(cropped, name: "favicon-square.png", size: 512)
for (name, size) in [("favicon-32x32.png", 32), ("favicon-48x48.png", 48), ("favicon-192x192.png", 192)] {
    writePNG(cropped, name: name, size: size)
}

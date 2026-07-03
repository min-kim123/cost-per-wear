import CoreImage
import ExpoModulesCore
import UIKit
import Vision

enum SubjectLiftError: Error, LocalizedError {
  case unavailable
  case invalidSource
  case invalidImage
  case noSubjectFound
  case renderFailed
  case writeFailed

  var errorDescription: String? {
    switch self {
    case .unavailable:
      return "Subject lifting requires iOS 17 or later."
    case .invalidSource:
      return "Could not read the source image."
    case .invalidImage:
      return "The source file is not a valid image."
    case .noSubjectFound:
      return "No subject was found in the image."
    case .renderFailed:
      return "Could not render the cutout image."
    case .writeFailed:
      return "Could not save the cutout image."
    }
  }
}

extension CGImagePropertyOrientation {
  // Vision needs pixel-buffer-relative orientation, not UIImage's separate
  // imageOrientation flag, or a photo shot in portrait comes out sideways.
  init(_ uiOrientation: UIImage.Orientation) {
    switch uiOrientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}

// Wraps VNGenerateForegroundInstanceMaskRequest (Vision, iOS 17+) — the same
// on-device model behind Photos' "lift subject" long-press gesture — to cut
// the main subject out of a photo onto a transparent background.
public class SubjectLiftModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SubjectLift")

    Constant("isAvailable") {
      if #available(iOS 17.0, *) {
        return true
      }
      return false
    }

    AsyncFunction("liftSubject") { (sourceUri: String) throws -> String in
      try SubjectLiftModule.liftSubjectSync(sourceUri: sourceUri)
    }
  }

  private static func liftSubjectSync(sourceUri: String) throws -> String {
    guard #available(iOS 17.0, *) else {
      throw SubjectLiftError.unavailable
    }

    guard let url = URL(string: sourceUri), let data = try? Data(contentsOf: url) else {
      throw SubjectLiftError.invalidSource
    }
    guard let uiImage = UIImage(data: data), let cgImage = uiImage.cgImage else {
      throw SubjectLiftError.invalidImage
    }

    let orientation = CGImagePropertyOrientation(uiImage.imageOrientation)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()

    do {
      try handler.perform([request])
    } catch {
      throw SubjectLiftError.noSubjectFound
    }

    guard let result = request.results?.first, !result.allInstances.isEmpty else {
      throw SubjectLiftError.noSubjectFound
    }

    let maskedPixelBuffer: CVPixelBuffer
    do {
      maskedPixelBuffer = try result.generateMaskedImage(
        ofInstances: result.allInstances,
        from: handler,
        croppedToInstancesExtent: true
      )
    } catch {
      throw SubjectLiftError.renderFailed
    }

    let ciImage = CIImage(cvPixelBuffer: maskedPixelBuffer)
    let context = CIContext()
    guard let outputCGImage = context.createCGImage(ciImage, from: ciImage.extent) else {
      throw SubjectLiftError.renderFailed
    }

    let outputImage = UIImage(cgImage: outputCGImage)
    guard let pngData = outputImage.pngData() else {
      throw SubjectLiftError.renderFailed
    }

    let destURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("subject-lift-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 0...999_999))")
      .appendingPathExtension("png")

    do {
      try pngData.write(to: destURL)
    } catch {
      throw SubjectLiftError.writeFailed
    }

    return destURL.absoluteString
  }
}

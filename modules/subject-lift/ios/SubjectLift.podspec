Pod::Spec.new do |s|
  s.name           = 'SubjectLift'
  s.version        = '1.0.0'
  s.summary        = 'On-device subject cutout using the Vision framework.'
  s.description    = 'Local Expo module wrapping VNGenerateForegroundInstanceMaskRequest to cut the main subject out of a photo with a transparent background, entirely on-device.'
  s.license        = 'UNLICENSED'
  s.author         = 'cost-per-wear'
  s.homepage       = 'https://github.com/minkim/cost-per-wear'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { path: '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

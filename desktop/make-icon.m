// Draws the Mac app icon: the Final Fore monogram on the black tile the app's sidebar uses.
// Usage: make-icon <monogram.png> <output-1024.png>
#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSImage *monogram = argc == 3 ? [[NSImage alloc] initWithContentsOfFile:@(argv[1])] : nil;
        if (!monogram) { fprintf(stderr, "usage: make-icon <monogram.png> <output.png>\n"); return 1; }

        const CGFloat side = 1024;
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL pixelsWide:side pixelsHigh:side bitsPerSample:8 samplesPerPixel:4
                            hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];

        // Apple's icon grid: an 824pt tile centred on a 1024pt canvas.
        [NSColor.blackColor setFill];
        [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(100, 100, 824, 824) xRadius:185 yRadius:185] fill];

        CGFloat height = 600, width = height * monogram.size.width / monogram.size.height;
        [monogram drawInRect:NSMakeRect((side - width) / 2, (side - height) / 2, width, height)
                    fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];

        [NSGraphicsContext.currentContext flushGraphics];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        return [png writeToFile:@(argv[2]) atomically:YES] ? 0 : 1;
    }
}

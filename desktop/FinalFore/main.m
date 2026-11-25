// Final Fore for Mac: a native window around the hosted app.
// The app itself, its data and its secrets stay on the server; this shell adds
// a Dock icon, menus, printing, downloads, uploads and a remembered text size.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const FFZoomChanged = @"FinalForePageZoomChanged";
static NSString *const FFPrintMessage = @"finalForePrint";

/// The hosted app. `defaults write com.finalforemedia.desktop HomeURL http://127.0.0.1:3107/`
/// points the shell at a local build instead.
static NSURL *FFHomeURL(void) {
    static NSURL *home;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSURL *custom = [NSURL URLWithString:[NSUserDefaults.standardUserDefaults stringForKey:@"HomeURL"] ?: @""];
        BOOL usable = custom.host.length && [@[@"http", @"https"] containsObject:custom.scheme.lowercaseString ?: @""];
        home = usable ? custom : [NSURL URLWithString:@"https://my.finalforemedia.com/"];
    });
    return home;
}

/// Pages on the app's own host stay in the app; everything else opens in the default browser.
static BOOL FFStaysInApp(NSURL *url) {
    NSString *scheme = url.scheme.lowercaseString ?: @"";
    if ([@[@"about", @"blob", @"data"] containsObject:scheme]) return YES;
    if (![@[@"http", @"https"] containsObject:scheme]) return NO;
    NSString *host = url.host.lowercaseString ?: @"";
    return [host isEqualToString:@"my.finalforemedia.com"] || [host isEqualToString:FFHomeURL().host.lowercaseString];
}

static NSArray<NSNumber *> *FFZoomSteps(void) { return @[@0.8, @0.9, @1.0, @1.1, @1.25, @1.5, @1.75, @2.0]; }

static CGFloat FFSavedZoom(void) {
    double saved = [NSUserDefaults.standardUserDefaults doubleForKey:@"PageZoom"];
    return saved > 0 ? saved : 1.0;
}

static NSString *FFEscapeHTML(NSString *text) {
    text = [text stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"];
    text = [text stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
    text = [text stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
    return [text stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"];
}

static void FFPrint(WKWebView *webView) {
    if (!webView.window) return;
    NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
    info.horizontalPagination = NSPrintingPaginationModeFit;
    info.verticalPagination = NSPrintingPaginationModeAutomatic;
    info.horizontallyCentered = NO;
    info.verticallyCentered = NO;
    NSPrintOperation *operation = [webView printOperationWithPrintInfo:info];
    operation.view.frame = webView.bounds;
    [operation runOperationModalForWindow:webView.window delegate:nil didRunSelector:NULL contextInfo:NULL];
}

@class FFWindowController;

@interface FFAppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler>
- (FFWindowController *)openWindowWithConfiguration:(WKWebViewConfiguration *)configuration popup:(BOOL)popup;
- (void)windowControllerDidClose:(FFWindowController *)controller;
@end

// MARK: - Window

@interface FFWindowController : NSObject <NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) WKWebView *webView;
/// Popups opened by the page stay hidden until they show an in-app page, so a
/// link that hands off to the default browser never flashes an empty window.
@property (nonatomic) BOOL popup;
@property (nonatomic, strong) NSMapTable<WKDownload *, NSURL *> *destinations;
@end

@implementation FFWindowController

- (instancetype)initWithConfiguration:(WKWebViewConfiguration *)configuration popup:(BOOL)popup {
    if (!(self = [super init])) return nil;
    _popup = popup;
    _destinations = [NSMapTable strongToStrongObjectsMapTable];
    NSRect screen = NSScreen.mainScreen ? NSScreen.mainScreen.visibleFrame : NSMakeRect(0, 0, 1440, 900);
    NSRect frame = NSMakeRect(0, 0, MIN(1440, screen.size.width), MIN(940, screen.size.height));
    _window = [[NSWindow alloc] initWithContentRect:frame
                                          styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                    NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                            backing:NSBackingStoreBuffered defer:NO];
    _window.title = @"Final Fore";
    _window.minSize = NSMakeSize(900, 600);
    _window.releasedWhenClosed = NO;
    _window.tabbingMode = NSWindowTabbingModeDisallowed;
    _window.delegate = self;
    [_window center];
    if (!popup) [_window setFrameAutosaveName:@"FinalForeMainWindow"];

    _webView = [[WKWebView alloc] initWithFrame:frame configuration:configuration];
    _webView.navigationDelegate = self;
    _webView.UIDelegate = self;
    _webView.allowsBackForwardNavigationGestures = YES;
    _webView.pageZoom = FFSavedZoom();
    _webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _window.contentView = _webView;
    _window.initialFirstResponder = _webView;
    [_webView addObserver:self forKeyPath:@"title" options:NSKeyValueObservingOptionNew context:NULL];
    return self;
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    self.window.title = self.webView.title.length ? self.webView.title : @"Final Fore";
}

- (void)show {
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.webView];
}

- (void)closeIfHiddenPopup {
    if (self.popup && !self.window.visible) [self.window close];
}

- (void)windowWillClose:(NSNotification *)notification {
    [self.webView removeObserver:self forKeyPath:@"title"];
    self.webView.navigationDelegate = nil;
    self.webView.UIDelegate = nil;
    [(FFAppDelegate *)NSApp.delegate windowControllerDidClose:self];
}

// MARK: Menu actions (reached through the responder chain as the window's delegate)

- (void)goHome:(id)sender { [self.webView loadRequest:[NSURLRequest requestWithURL:FFHomeURL()]]; }

- (void)reloadPage:(id)sender {
    if (!self.webView.URL || [self.webView.URL.scheme isEqualToString:@"about"]) [self goHome:sender];
    else [self.webView reload];
}

- (void)goBackInHistory:(id)sender { [self.webView goBack]; }
- (void)goForwardInHistory:(id)sender { [self.webView goForward]; }
- (void)printPage:(id)sender { FFPrint(self.webView); }

- (void)stepZoom:(NSInteger)direction {
    CGFloat current = self.webView.pageZoom, next = current;
    NSArray<NSNumber *> *steps = FFZoomSteps();
    if (direction > 0) {
        for (NSNumber *step in steps) if (step.doubleValue > current + 0.001) { next = step.doubleValue; break; }
    } else {
        for (NSNumber *step in steps.reverseObjectEnumerator) if (step.doubleValue < current - 0.001) { next = step.doubleValue; break; }
    }
    [self saveZoom:next];
}

- (void)saveZoom:(CGFloat)zoom {
    [NSUserDefaults.standardUserDefaults setDouble:zoom forKey:@"PageZoom"];
    [NSNotificationCenter.defaultCenter postNotificationName:FFZoomChanged object:nil];
}

- (void)zoomTextIn:(id)sender { [self stepZoom:1]; }
- (void)zoomTextOut:(id)sender { [self stepZoom:-1]; }
- (void)zoomTextReset:(id)sender { [self saveZoom:1.0]; }

- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (item.action == @selector(goBackInHistory:)) return self.webView.canGoBack;
    if (item.action == @selector(goForwardInHistory:)) return self.webView.canGoForward;
    if (item.action == @selector(zoomTextIn:)) return self.webView.pageZoom < FFZoomSteps().lastObject.doubleValue - 0.001;
    if (item.action == @selector(zoomTextOut:)) return self.webView.pageZoom > FFZoomSteps().firstObject.doubleValue + 0.001;
    return YES;
}

// MARK: Navigation

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action
                                                     decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if (action.shouldPerformDownload) { decisionHandler(WKNavigationActionPolicyDownload); return; }
    NSURL *url = action.request.URL;
    if (!url) { decisionHandler(WKNavigationActionPolicyCancel); return; }
    BOOL mainFrame = !action.targetFrame || action.targetFrame.mainFrame;
    if (mainFrame && !FFStaysInApp(url)) {
        if ([@[@"http", @"https", @"mailto", @"tel"] containsObject:url.scheme.lowercaseString ?: @""]) {
            [NSWorkspace.sharedWorkspace openURL:url];
        }
        decisionHandler(WKNavigationActionPolicyCancel);
        // A popup that only existed to hand a link to the browser has nothing left to show.
        [self closeIfHiddenPopup];
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationResponse:(WKNavigationResponse *)response
                                                       decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    NSString *disposition = @"";
    if ([response.response isKindOfClass:NSHTTPURLResponse.class]) {
        disposition = [(NSHTTPURLResponse *)response.response valueForHTTPHeaderField:@"Content-Disposition"] ?: @"";
    }
    BOOL attachment = [disposition.lowercaseString hasPrefix:@"attachment"];
    decisionHandler(attachment || !response.canShowMIMEType ? WKNavigationResponsePolicyDownload : WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView didCommitNavigation:(WKNavigation *)navigation {
    if (self.popup && !self.window.visible && webView.URL && ![webView.URL.scheme isEqualToString:@"about"]) [self show];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showFailure:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showFailure:error];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView { [webView reload]; }

- (void)showFailure:(NSError *)error {
    // Cancelled loads and loads that turned into downloads are not failures.
    if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) return;
    if ([error.domain isEqualToString:@"WebKitErrorDomain"] && error.code == 102) return;
    NSURL *failed = error.userInfo[NSURLErrorFailingURLErrorKey];
    NSURL *retry = failed && FFStaysInApp(failed) && ![failed.scheme isEqualToString:@"about"] ? failed : FFHomeURL();
    NSString *page = [NSString stringWithFormat:
        @"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Final Fore</title><style>"
        "html{height:100%%}body{min-height:100%%;margin:0;display:grid;place-items:center;background:#fff;color:#000;"
        "font:16px/1.5 -apple-system,system-ui,sans-serif}main{max-width:32rem;padding:2rem}"
        "h1{font-size:24px;margin:0 0 .5rem}p{margin:0 0 1.5rem;color:#333}"
        "a{display:inline-block;padding:.6rem 1.1rem;border-radius:6px;background:#000;color:#fff;"
        "font-weight:600;text-decoration:none}a:focus-visible{outline:3px solid #cb10be;outline-offset:2px}"
        "</style></head><body><main><h1>Final Fore could not be reached</h1><p>%@</p>"
        "<a href=\"%@\">Try again</a></main></body></html>",
        FFEscapeHTML(error.localizedDescription), FFEscapeHTML(retry.absoluteString)];
    [self.webView loadHTMLString:page baseURL:nil];
    if (self.popup && !self.window.visible) [self show];
}

// MARK: Windows opened by the page

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
   forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    NSURL *url = action.request.URL;
    // External links never need a window of their own.
    if (url.absoluteString.length && !FFStaysInApp(url)) {
        [NSWorkspace.sharedWorkspace openURL:url];
        return nil;
    }
    return [(FFAppDelegate *)NSApp.delegate openWindowWithConfiguration:configuration popup:YES].webView;
}

- (void)webViewDidClose:(WKWebView *)webView { [self.window close]; }

// MARK: Dialogs and uploads

- (void)present:(NSAlert *)alert completion:(void (^)(NSModalResponse))completion {
    if (self.window.visible) [alert beginSheetModalForWindow:self.window completionHandler:completion];
    else completion([alert runModal]);
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [NSAlert new];
    alert.messageText = message;
    [alert addButtonWithTitle:@"OK"];
    [self present:alert completion:^(NSModalResponse response) { completionHandler(); }];
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    NSAlert *alert = [NSAlert new];
    alert.messageText = message;
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    [self present:alert completion:^(NSModalResponse response) { completionHandler(response == NSAlertFirstButtonReturn); }];
}

- (void)webView:(WKWebView *)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
    NSAlert *alert = [NSAlert new];
    alert.messageText = prompt;
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 320, 24)];
    field.stringValue = defaultText ?: @"";
    alert.accessoryView = field;
    alert.window.initialFirstResponder = field;
    [self present:alert completion:^(NSModalResponse response) {
        completionHandler(response == NSAlertFirstButtonReturn ? field.stringValue : nil);
    }];
}

- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    panel.canChooseDirectories = parameters.allowsDirectories;
    panel.canChooseFiles = YES;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
        completionHandler(response == NSModalResponseOK ? panel.URLs : nil);
    }];
}

// MARK: Downloads (saved to the Downloads folder, then shown in Finder)

- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response
    suggestedFilename:(NSString *)suggestedFilename completionHandler:(void (^)(NSURL *))completionHandler {
    NSFileManager *files = NSFileManager.defaultManager;
    NSURL *folder = [files URLsForDirectory:NSDownloadsDirectory inDomains:NSUserDomainMask].firstObject;
    if (!folder) { completionHandler(nil); return; }
    // The server names the file; keep only its last path component.
    NSString *name = suggestedFilename.lastPathComponent;
    if (!name.length || [name hasPrefix:@"."] || [name isEqualToString:@"/"]) name = @"Final Fore download";
    NSString *base = name.stringByDeletingPathExtension, *extension = name.pathExtension;
    NSURL *destination = [folder URLByAppendingPathComponent:name];
    for (int copy = 2; [files fileExistsAtPath:destination.path]; copy++) {
        NSString *next = extension.length ? [NSString stringWithFormat:@"%@ %d.%@", base, copy, extension]
                                          : [NSString stringWithFormat:@"%@ %d", base, copy];
        destination = [folder URLByAppendingPathComponent:next];
    }
    [self.destinations setObject:destination forKey:download];
    completionHandler(destination);
}

- (void)downloadDidFinish:(WKDownload *)download {
    NSURL *saved = [self.destinations objectForKey:download];
    [self.destinations removeObjectForKey:download];
    if (saved) [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[saved]];
    [self closeIfHiddenPopup];
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
    [self.destinations removeObjectForKey:download];
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"The download did not finish";
    alert.informativeText = error.localizedDescription;
    [alert addButtonWithTitle:@"OK"];
    [self present:alert completion:^(NSModalResponse response) { [self closeIfHiddenPopup]; }];
}

@end

// MARK: - Application

@implementation FFAppDelegate {
    NSMutableArray<FFWindowController *> *_controllers;
    WKWebViewConfiguration *_configuration;
}

/// Every window shares one configuration, so they share the sign-in.
- (WKWebViewConfiguration *)configuration {
    if (_configuration) return _configuration;
    _configuration = [WKWebViewConfiguration new];
    _configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    _configuration.applicationNameForUserAgent = @"Version/18.0 Safari/605.1.15 FinalForeDesktop/1.0";
    // Pages call window.print(); WKWebView ignores it unless the app runs the print panel.
    NSString *source = @"window.print = function () { window.webkit.messageHandlers.finalForePrint.postMessage(null); };";
    [_configuration.userContentController addUserScript:
        [[WKUserScript alloc] initWithSource:source injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO]];
    [_configuration.userContentController addScriptMessageHandler:self name:FFPrintMessage];
    return _configuration;
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString:FFPrintMessage] && message.webView) FFPrint(message.webView);
}

- (FFWindowController *)openWindowWithConfiguration:(WKWebViewConfiguration *)configuration popup:(BOOL)popup {
    FFWindowController *controller =
        [[FFWindowController alloc] initWithConfiguration:configuration ?: [self configuration] popup:popup];
    for (FFWindowController *open in _controllers.reverseObjectEnumerator) {
        if (!open.window.visible) continue;
        NSRect front = open.window.frame;
        [controller.window setFrameTopLeftPoint:
            [controller.window cascadeTopLeftFromPoint:NSMakePoint(NSMinX(front), NSMaxY(front))]];
        break;
    }
    [_controllers addObject:controller];
    if (!popup) {
        [controller.webView loadRequest:[NSURLRequest requestWithURL:FFHomeURL()]];
        [controller show];
    }
    return controller;
}

- (void)windowControllerDidClose:(FFWindowController *)controller {
    // Let the window finish closing before its controller is released.
    dispatch_async(dispatch_get_main_queue(), ^{ [self->_controllers removeObject:controller]; });
}

- (void)newWindow:(id)sender { [self openWindowWithConfiguration:nil popup:NO]; }

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    _controllers = [NSMutableArray new];
    NSApp.mainMenu = [self buildMenu];
    [NSNotificationCenter.defaultCenter addObserverForName:FFZoomChanged object:nil queue:NSOperationQueue.mainQueue
                                                usingBlock:^(NSNotification *note) {
        for (FFWindowController *controller in self->_controllers) controller.webView.pageZoom = FFSavedZoom();
    }];
    [self newWindow:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    if (!visible) [self newWindow:nil];
    return YES;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication *)app { return YES; }

static NSMenuItem *FFItem(NSString *title, SEL action, NSString *key, NSEventModifierFlags modifiers) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    item.keyEquivalentModifierMask = modifiers;
    return item;
}

static NSMenuItem *FFMenu(NSString *title, NSArray<NSMenuItem *> *items) {
    NSMenuItem *parent = [[NSMenuItem alloc] initWithTitle:title action:NULL keyEquivalent:@""];
    NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
    for (NSMenuItem *item in items) [menu addItem:item];
    parent.submenu = menu;
    return parent;
}

- (NSMenu *)buildMenu {
    NSEventModifierFlags cmd = NSEventModifierFlagCommand;
    NSMenu *main = [NSMenu new];

    [main addItem:FFMenu(@"Final Fore", @[
        FFItem(@"About Final Fore", @selector(orderFrontStandardAboutPanel:), @"", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Hide Final Fore", @selector(hide:), @"h", cmd),
        FFItem(@"Hide Others", @selector(hideOtherApplications:), @"h", cmd | NSEventModifierFlagOption),
        FFItem(@"Show All", @selector(unhideAllApplications:), @"", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Quit Final Fore", @selector(terminate:), @"q", cmd),
    ])];

    NSMenuItem *newWindow = FFItem(@"New Window", @selector(newWindow:), @"n", cmd);
    newWindow.target = self;
    [main addItem:FFMenu(@"File", @[
        newWindow,
        FFItem(@"Close Window", @selector(performClose:), @"w", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Print…", @selector(printPage:), @"p", cmd),
    ])];

    [main addItem:FFMenu(@"Edit", @[
        FFItem(@"Undo", NSSelectorFromString(@"undo:"), @"z", cmd),
        FFItem(@"Redo", NSSelectorFromString(@"redo:"), @"z", cmd | NSEventModifierFlagShift),
        NSMenuItem.separatorItem,
        FFItem(@"Cut", @selector(cut:), @"x", cmd),
        FFItem(@"Copy", @selector(copy:), @"c", cmd),
        FFItem(@"Paste", @selector(paste:), @"v", cmd),
        FFItem(@"Select All", @selector(selectAll:), @"a", cmd),
    ])];

    [main addItem:FFMenu(@"View", @[
        FFItem(@"Reload", @selector(reloadPage:), @"r", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Actual Size", @selector(zoomTextReset:), @"0", cmd),
        FFItem(@"Zoom In", @selector(zoomTextIn:), @"+", cmd),
        FFItem(@"Zoom Out", @selector(zoomTextOut:), @"-", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Enter Full Screen", @selector(toggleFullScreen:), @"f", cmd | NSEventModifierFlagControl),
    ])];

    [main addItem:FFMenu(@"Go", @[
        FFItem(@"Back", @selector(goBackInHistory:), @"[", cmd),
        FFItem(@"Forward", @selector(goForwardInHistory:), @"]", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Home", @selector(goHome:), @"h", cmd | NSEventModifierFlagShift),
    ])];

    NSMenuItem *windowMenu = FFMenu(@"Window", @[
        FFItem(@"Minimize", @selector(performMiniaturize:), @"m", cmd),
        FFItem(@"Zoom", @selector(performZoom:), @"", cmd),
        NSMenuItem.separatorItem,
        FFItem(@"Bring All to Front", @selector(arrangeInFront:), @"", cmd),
    ]);
    [main addItem:windowMenu];
    NSApp.windowsMenu = windowMenu.submenu;
    return main;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        FFAppDelegate *delegate = [FFAppDelegate new];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}

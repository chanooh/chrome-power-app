#include <napi.h>
#include <iostream>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

#ifdef __APPLE__
#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#endif

namespace {
constexpr int64_t kChromePowerSyntheticEventMarker = 0x43505231;
}

#ifdef _WIN32
#include <windows.h>
#include <cstring>
#endif

// Error logging macro
#define LOG_ERROR(msg) \
    do { \
        std::cerr << "Error: " << msg << " (line: " << __LINE__ << ")" << std::endl; \
    } while (0)

#ifdef _WIN32
    #define CHECK_WINDOW_OPERATION(op, msg) \
        do { \
            if (!(op)) { \
                LOG_ERROR(msg << " (LastError: " << GetLastError() << ")"); \
            } \
        } while (0)
#endif

// Platform specific window info structure
#ifdef _WIN32
struct WindowInfo {
    HWND hwnd;
    bool isExtension;
    int width;
    int height;
};
#elif __APPLE__
struct WindowInfo {
    AXUIElementRef window;
    pid_t pid;
    bool isExtension;
    int width;
    int height;
};
#endif

// Monitor info structure (for multi-monitor support)
#ifdef _WIN32
struct MonitorInfo {
    HMONITOR handle;
    RECT rect;
    bool isPrimary;
};
#elif __APPLE__
struct MonitorInfo {
    CGDirectDisplayID id;
    CGRect bounds;
    bool isPrimary;
};
#else
// Dummy struct for Linux (not supported but allows compilation)
struct MonitorInfo {
    int id;
    bool isPrimary;
    int x, y, width, height;
};
#endif

// Forward declaration of GetMonitors function
std::vector<MonitorInfo> GetMonitors();

class WindowManager : public Napi::ObjectWrap<WindowManager> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "WindowManager", {
            InstanceMethod("arrangeWindows", &WindowManager::ArrangeWindows),
            InstanceMethod("sendMouseEvent", &WindowManager::SendMouseEvent),
            InstanceMethod("sendMouseEventWithPopupMatching", &WindowManager::SendMouseEventWithPopupMatching),
            InstanceMethod("sendKeyboardEvent", &WindowManager::SendKeyboardEvent),
            InstanceMethod("sendWheelEvent", &WindowManager::SendWheelEvent),
            InstanceMethod("getWindowBounds", &WindowManager::GetWindowBounds),
            InstanceMethod("getAllWindows", &WindowManager::GetAllWindows),
            InstanceMethod("getMonitors", &WindowManager::GetMonitorsJS),
            InstanceMethod("isProcessWindowActive", &WindowManager::IsProcessWindowActive),
            InstanceMethod("startEventCapture", &WindowManager::StartEventCapture),
            InstanceMethod("stopEventCapture", &WindowManager::StopEventCapture),
            InstanceMethod("getPermissionStatus", &WindowManager::GetPermissionStatus),
            InstanceMethod("requestListenAccess", &WindowManager::RequestListenAccess),
            InstanceMethod("requestPostAccess", &WindowManager::RequestPostAccess)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("WindowManager", func);
        return exports;
    }

    WindowManager(const Napi::CallbackInfo& info) : Napi::ObjectWrap<WindowManager>(info) {}

    ~WindowManager() override {
        StopEventCaptureInternal();
    }

private:
#ifdef __APPLE__
    struct CapturedEvent {
        CGEventType type;
        double x;
        double y;
        int64_t button;
        int64_t clickCount;
        int64_t deltaX;
        int64_t deltaY;
        int64_t keyCode;
        uint64_t flags;
        uint64_t timestamp;
        int64_t sourcePid;
        std::vector<UniChar> text;
    };

    std::atomic<bool> eventCaptureRunning_{false};
    std::thread eventCaptureThread_;
    std::mutex eventCaptureMutex_;
    std::condition_variable eventCaptureReady_;
    CFMachPortRef eventTap_ = nullptr;
    CFRunLoopSourceRef eventTapSource_ = nullptr;
    CFRunLoopRef eventCaptureRunLoop_ = nullptr;
    Napi::ThreadSafeFunction eventCallback_;

    static const char* EventTypeName(CGEventType type) {
        switch (type) {
            case kCGEventLeftMouseDown: return "leftMouseDown";
            case kCGEventLeftMouseUp: return "leftMouseUp";
            case kCGEventRightMouseDown: return "rightMouseDown";
            case kCGEventRightMouseUp: return "rightMouseUp";
            case kCGEventOtherMouseDown: return "otherMouseDown";
            case kCGEventOtherMouseUp: return "otherMouseUp";
            case kCGEventMouseMoved: return "mouseMoved";
            case kCGEventLeftMouseDragged: return "leftMouseDragged";
            case kCGEventRightMouseDragged: return "rightMouseDragged";
            case kCGEventOtherMouseDragged: return "otherMouseDragged";
            case kCGEventScrollWheel: return "scrollWheel";
            case kCGEventKeyDown: return "keyDown";
            case kCGEventKeyUp: return "keyUp";
            case kCGEventFlagsChanged: return "flagsChanged";
            default: return "unknown";
        }
    }

    static CGEventRef EventTapCallback(
        CGEventTapProxy,
        CGEventType type,
        CGEventRef event,
        void* userInfo
    ) {
        auto* self = static_cast<WindowManager*>(userInfo);
        if (!self || !event) return event;

        if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
            if (self->eventTap_ && self->eventCaptureRunning_.load()) {
                CGEventTapEnable(self->eventTap_, true);
            }
            return event;
        }

        if (!self->eventCaptureRunning_.load()) return event;
        if (CGEventGetIntegerValueField(event, kCGEventSourceUserData) == kChromePowerSyntheticEventMarker) {
            return event;
        }

        auto* data = new CapturedEvent();
        CGPoint location = CGEventGetLocation(event);
        data->type = type;
        data->x = location.x;
        data->y = location.y;
        data->button = CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber);
        data->clickCount = CGEventGetIntegerValueField(event, kCGMouseEventClickState);
        data->deltaX = CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis2);
        data->deltaY = CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis1);
        data->keyCode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        data->flags = static_cast<uint64_t>(CGEventGetFlags(event));
        data->timestamp = CGEventGetTimestamp(event);
        data->sourcePid = CGEventGetIntegerValueField(event, kCGEventSourceUnixProcessID);

        if (type == kCGEventKeyDown) {
            UniChar chars[64];
            UniCharCount length = 0;
            CGEventKeyboardGetUnicodeString(event, 64, &length, chars);
            data->text.assign(chars, chars + length);
        }

        napi_status status = self->eventCallback_.NonBlockingCall(
            data,
            [](Napi::Env env, Napi::Function callback, CapturedEvent* captured) {
                if (env && callback) {
                    Napi::Object value = Napi::Object::New(env);
                    value.Set("type", EventTypeName(captured->type));
                    value.Set("x", captured->x);
                    value.Set("y", captured->y);
                    value.Set("button", Napi::Number::New(env, captured->button));
                    value.Set("clickCount", Napi::Number::New(env, captured->clickCount));
                    value.Set("deltaX", Napi::Number::New(env, captured->deltaX));
                    value.Set("deltaY", Napi::Number::New(env, captured->deltaY));
                    value.Set("keyCode", Napi::Number::New(env, captured->keyCode));
                    value.Set("flags", Napi::Number::New(env, static_cast<double>(captured->flags)));
                    value.Set("timestamp", Napi::Number::New(env, static_cast<double>(captured->timestamp)));
                    value.Set("sourcePid", Napi::Number::New(env, captured->sourcePid));
                    if (!captured->text.empty()) {
                        value.Set(
                            "text",
                            Napi::String::New(
                                env,
                                reinterpret_cast<const char16_t*>(captured->text.data()),
                                captured->text.size()
                            )
                        );
                    }
                    callback.Call({value});
                }
                delete captured;
            }
        );

        if (status != napi_ok) delete data;
        return event;
    }

    void StopEventCaptureInternal() {
        if (!eventCaptureRunning_.exchange(false)) return;

        {
            std::lock_guard<std::mutex> lock(eventCaptureMutex_);
            if (eventCaptureRunLoop_) CFRunLoopStop(eventCaptureRunLoop_);
        }

        if (eventCaptureThread_.joinable()) eventCaptureThread_.join();

        if (eventTapSource_) {
            CFRelease(eventTapSource_);
            eventTapSource_ = nullptr;
        }
        if (eventTap_) {
            CFRelease(eventTap_);
            eventTap_ = nullptr;
        }
    }
#else
    void StopEventCaptureInternal() {}
#endif

    Napi::Value GetPermissionStatus(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Object result = Napi::Object::New(env);
#ifdef __APPLE__
        result.Set("accessibility", Napi::Boolean::New(env, AXIsProcessTrusted()));
        result.Set("listenEvents", Napi::Boolean::New(env, CGPreflightListenEventAccess()));
        result.Set("postEvents", Napi::Boolean::New(env, CGPreflightPostEventAccess()));
        result.Set("supported", Napi::Boolean::New(env, true));
#else
        result.Set("accessibility", Napi::Boolean::New(env, false));
        result.Set("listenEvents", Napi::Boolean::New(env, false));
        result.Set("postEvents", Napi::Boolean::New(env, false));
        result.Set("supported", Napi::Boolean::New(env, false));
#endif
        return result;
    }

    Napi::Value RequestListenAccess(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
#ifdef __APPLE__
        return Napi::Boolean::New(env, CGRequestListenEventAccess());
#else
        return Napi::Boolean::New(env, false);
#endif
    }

    Napi::Value RequestPostAccess(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
#ifdef __APPLE__
        return Napi::Boolean::New(env, CGRequestPostEventAccess());
#else
        return Napi::Boolean::New(env, false);
#endif
    }

    Napi::Value StartEventCapture(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
#ifdef __APPLE__
        if (eventCaptureRunning_.load()) return Napi::Boolean::New(env, true);
        if (info.Length() < 1 || !info[0].IsFunction()) {
            Napi::TypeError::New(env, "startEventCapture requires a callback").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (!CGPreflightListenEventAccess()) {
            Napi::Error::New(env, "Input Monitoring permission is required").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        CGEventMask mask =
            CGEventMaskBit(kCGEventLeftMouseDown) |
            CGEventMaskBit(kCGEventLeftMouseUp) |
            CGEventMaskBit(kCGEventRightMouseDown) |
            CGEventMaskBit(kCGEventRightMouseUp) |
            CGEventMaskBit(kCGEventOtherMouseDown) |
            CGEventMaskBit(kCGEventOtherMouseUp) |
            CGEventMaskBit(kCGEventMouseMoved) |
            CGEventMaskBit(kCGEventLeftMouseDragged) |
            CGEventMaskBit(kCGEventRightMouseDragged) |
            CGEventMaskBit(kCGEventOtherMouseDragged) |
            CGEventMaskBit(kCGEventScrollWheel) |
            CGEventMaskBit(kCGEventKeyDown) |
            CGEventMaskBit(kCGEventKeyUp) |
            CGEventMaskBit(kCGEventFlagsChanged);

        eventTap_ = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly,
            mask,
            EventTapCallback,
            this
        );
        if (!eventTap_) {
            Napi::Error::New(env, "Unable to create macOS event tap").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        eventTapSource_ = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap_, 0);
        if (!eventTapSource_) {
            CFRelease(eventTap_);
            eventTap_ = nullptr;
            Napi::Error::New(env, "Unable to create event tap run loop source").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        eventCallback_ = Napi::ThreadSafeFunction::New(
            env,
            info[0].As<Napi::Function>(),
            "ChromePowerMacInput",
            0,
            1
        );
        eventCaptureRunning_.store(true);
        eventCaptureThread_ = std::thread([this]() {
            @autoreleasepool {
                CFRunLoopRef runLoop = CFRunLoopGetCurrent();
                CFRetain(runLoop);
                {
                    std::lock_guard<std::mutex> lock(eventCaptureMutex_);
                    eventCaptureRunLoop_ = runLoop;
                }
                eventCaptureReady_.notify_all();
                CFRunLoopAddSource(runLoop, eventTapSource_, kCFRunLoopCommonModes);
                CGEventTapEnable(eventTap_, true);
                CFRunLoopRun();
                CFRunLoopRemoveSource(runLoop, eventTapSource_, kCFRunLoopCommonModes);
                {
                    std::lock_guard<std::mutex> lock(eventCaptureMutex_);
                    eventCaptureRunLoop_ = nullptr;
                }
                CFRelease(runLoop);
                eventCallback_.Release();
            }
        });

        {
            std::unique_lock<std::mutex> lock(eventCaptureMutex_);
            eventCaptureReady_.wait_for(
                lock,
                std::chrono::seconds(1),
                [this]() { return eventCaptureRunLoop_ != nullptr; }
            );
        }
        return Napi::Boolean::New(env, eventCaptureRunLoop_ != nullptr);
#else
        return Napi::Boolean::New(env, false);
#endif
    }

    Napi::Value StopEventCapture(const Napi::CallbackInfo& info) {
        StopEventCaptureInternal();
        return Napi::Boolean::New(info.Env(), true);
    }

    #ifdef _WIN32
    bool ArrangeWindow(HWND hwnd, int x, int y, int width, int height, bool preserveSize = false) {
        if (!hwnd) return false;
        
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
        
        LONG style = GetWindowLong(hwnd, GWL_STYLE);
        if (style == 0) {
            LOG_ERROR("Failed to get window style");
            return false;
        }
        
        style &= ~(WS_MAXIMIZE | WS_MINIMIZE);
        if (SetWindowLong(hwnd, GWL_STYLE, style) == 0) {
            LOG_ERROR("Failed to set window style");
            return false;
        }
        
        UINT flags = SWP_SHOWWINDOW | SWP_FRAMECHANGED;
        if (preserveSize) {
            flags |= SWP_NOSIZE;
        }
        
        if (!SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, flags)) {
            LOG_ERROR("Failed to set window position");
            return false;
        }
        
        if (!SetWindowPos(hwnd, HWND_NOTOPMOST, x, y, width, height, flags)) {
            LOG_ERROR("Failed to reset window z-order");
            return false;
        }
        
        return true;
    }

    bool IsExtensionWindow(const char* title, const char* className) {
        return title != nullptr &&
               strlen(title) > 0 &&
               strstr(title, "Google Chrome") == nullptr;
    }

    std::vector<WindowInfo> FindWindowsByPid(DWORD processId) {
        std::vector<WindowInfo> windows;
        HWND hwnd = nullptr;

        while ((hwnd = FindWindowEx(nullptr, hwnd, nullptr, nullptr)) != nullptr) {
            DWORD pid = 0;
            GetWindowThreadProcessId(hwnd, &pid);

            if (pid == processId && IsWindowVisible(hwnd) && !IsIconic(hwnd)) {
                char className[256] = {0};
                GetClassNameA(hwnd, className, sizeof(className));

                char title[256] = {0};
                GetWindowTextA(hwnd, title, sizeof(title));

                RECT rect;
                GetWindowRect(hwnd, &rect);

                bool isExtension = IsExtensionWindow(title, className);
                bool isMainWindow = strstr(title, "Google Chrome") != nullptr &&
                                  (GetWindowLong(hwnd, GWL_STYLE) & WS_OVERLAPPEDWINDOW);

                if (isMainWindow || isExtension) {
                    WindowInfo info;
                    info.hwnd = hwnd;
                    info.isExtension = isExtension;
                    info.width = rect.right - rect.left;
                    info.height = rect.bottom - rect.top;
                    windows.push_back(info);
                }
            }
        }
        return windows;
    }

    // Find popup windows (like context menus) belonging to a process
    std::vector<HWND> FindPopupWindows(DWORD processId) {
        std::vector<HWND> popups;
        HWND hwnd = nullptr;

        while ((hwnd = FindWindowEx(nullptr, hwnd, nullptr, nullptr)) != nullptr) {
            DWORD pid = 0;
            GetWindowThreadProcessId(hwnd, &pid);

            if (pid == processId && IsWindowVisible(hwnd)) {
                LONG style = GetWindowLong(hwnd, GWL_STYLE);

                // Check if it's a popup window (WS_POPUP)
                if (style & WS_POPUP) {
                    char className[256] = {0};
                    GetClassNameA(hwnd, className, sizeof(className));

                    // Common popup window classes: #32768 (menu), Chrome_WidgetWin_1, etc.
                    if (strcmp(className, "#32768") == 0 ||
                        strstr(className, "Chrome_WidgetWin") != nullptr) {
                        popups.push_back(hwnd);
                    }
                }
            }
        }
        return popups;
    }

    // Find best matching popup window based on relative position
    HWND FindMatchingPopup(HWND masterMainWindow, HWND masterPopup,
                          HWND slaveMainWindow, const std::vector<HWND>& slavePopups) {
        if (slavePopups.empty()) {
            return nullptr;
        }

        // Get master popup position relative to master main window
        RECT masterMainRect, masterPopupRect;
        GetWindowRect(masterMainWindow, &masterMainRect);
        GetWindowRect(masterPopup, &masterPopupRect);

        int masterRelX = masterPopupRect.left - masterMainRect.left;
        int masterRelY = masterPopupRect.top - masterMainRect.top;

        // Get slave main window position
        RECT slaveMainRect;
        GetWindowRect(slaveMainWindow, &slaveMainRect);

        // Find slave popup with closest relative position
        HWND bestMatch = nullptr;
        int minDistance = INT_MAX;

        for (HWND slavePopup : slavePopups) {
            RECT slavePopupRect;
            GetWindowRect(slavePopup, &slavePopupRect);

            int slaveRelX = slavePopupRect.left - slaveMainRect.left;
            int slaveRelY = slavePopupRect.top - slaveMainRect.top;

            // Calculate Manhattan distance
            int distance = abs(masterRelX - slaveRelX) + abs(masterRelY - slaveRelY);

            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = slavePopup;
            }
        }

        return bestMatch;
    }
    #elif __APPLE__
    bool CheckAccessibilityPermission() {
        @autoreleasepool {
            NSDictionary* options = @{(id)kAXTrustedCheckOptionPrompt: @YES};
            BOOL isEnabled = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
            
            if (!isEnabled) {
                NSAlert* alert = [[NSAlert alloc] init];
                [alert setMessageText:@"Accessibility Permission Required"];
                [alert setInformativeText:@"Chrome Power needs accessibility permission to manage windows. Please enable it in System Preferences."];
                [alert addButtonWithTitle:@"Open System Preferences"];
                [alert addButtonWithTitle:@"Cancel"];
                
                if ([alert runModal] == NSAlertFirstButtonReturn) {
                    [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
                }
            }
            
            return isEnabled;
        }
    }

    bool IsExtensionWindow(AXUIElementRef window) {
        // Check window title
        CFStringRef titleRef;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&titleRef) == kAXErrorSuccess) {
            char buffer[256];
            CFStringGetCString(titleRef, buffer, sizeof(buffer), kCFStringEncodingUTF8);
            CFRelease(titleRef);
            
            // Extension windows typically don't have "Google Chrome" in their titles
            // and are usually smaller floating windows
            if (strstr(buffer, "Google Chrome") == nullptr) {
                return true;
            }
        }

        // Check window role
        CFStringRef roleRef;
        if (AXUIElementCopyAttributeValue(window, kAXRoleAttribute, (CFTypeRef*)&roleRef) == kAXErrorSuccess) {
            char buffer[256];
            CFStringGetCString(roleRef, buffer, sizeof(buffer), kCFStringEncodingUTF8);
            CFRelease(roleRef);
            
            // Extension windows might have different roles
            if (strcmp(buffer, "AXWindow") == 0) {
                // Additional check for window level
                CFStringRef subroleRef;
                if (AXUIElementCopyAttributeValue(window, kAXSubroleAttribute, (CFTypeRef*)&subroleRef) == kAXErrorSuccess) {
                    char subroleBuffer[256];
                    CFStringGetCString(subroleRef, subroleBuffer, sizeof(subroleBuffer), kCFStringEncodingUTF8);
                    CFRelease(subroleRef);
                    
                    return strcmp(subroleBuffer, "AXStandardWindow") != 0;
                }
            }
        }

        return false;
    }

    void BringWindowToFront(AXUIElementRef window) {
        // Get the window's PID
        pid_t windowPid;
        if (AXUIElementGetPid(window, &windowPid) == kAXErrorSuccess) {
            // Create a new NSRunningApplication instance
            @autoreleasepool {
                NSRunningApplication* app = [NSRunningApplication runningApplicationWithProcessIdentifier:windowPid];
                if (app) {
                    [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
                }
            }
        }

        // Raise the window
        AXUIElementPerformAction(window, kAXRaiseAction);
    }

    bool IsMainWindow(AXUIElementRef window) {
        // Check window title
        CFStringRef titleRef;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&titleRef) == kAXErrorSuccess) {
            char buffer[256];
            CFStringGetCString(titleRef, buffer, sizeof(buffer), kCFStringEncodingUTF8);
            CFRelease(titleRef);
            
            // Main Chrome window should contain "Google Chrome" in title
            if (strstr(buffer, "Google Chrome") != nullptr) {
                // Also check subrole to ensure it's a standard window
                CFStringRef subroleRef;
                if (AXUIElementCopyAttributeValue(window, kAXSubroleAttribute, (CFTypeRef*)&subroleRef) == kAXErrorSuccess) {
                    char subroleBuffer[256];
                    CFStringGetCString(subroleRef, subroleBuffer, sizeof(subroleBuffer), kCFStringEncodingUTF8);
                    CFRelease(subroleRef);
                    
                    // Main window should have "AXStandardWindow" subrole
                    return strcmp(subroleBuffer, "AXStandardWindow") == 0;
                }
            }
        }
        
        return false;
    }

    std::vector<WindowInfo> GetWindowsForPid(pid_t pid) {
        std::vector<WindowInfo> windows;
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        if (!app) {
            LOG_ERROR("Failed to create AX UI Element for application");
            return windows;
        }

        CFArrayRef windowArray;
        if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, (CFTypeRef*)&windowArray) == kAXErrorSuccess) {
            CFIndex count = CFArrayGetCount(windowArray);
            for (CFIndex i = 0; i < count; i++) {
                AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windowArray, i);
                
                // Only process visible windows
                CFBooleanRef isMinimizedRef;
                bool isVisible = true;
                if (AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute, (CFTypeRef*)&isMinimizedRef) == kAXErrorSuccess) {
                    isVisible = !CFBooleanGetValue(isMinimizedRef);
                    CFRelease(isMinimizedRef);
                }

                if (isVisible) {
                    CGSize size = {0, 0};
                    AXValueRef sizeRef;
                    if (AXUIElementCopyAttributeValue(window, kAXSizeAttribute, (CFTypeRef*)&sizeRef) == kAXErrorSuccess) {
                        AXValueGetValue(sizeRef, (AXValueType)kAXValueCGSizeType, &size);
                        CFRelease(sizeRef);

                        bool isExtension = IsExtensionWindow(window);
                        bool isMain = IsMainWindow(window);

                        if (isMain || isExtension) {
                            WindowInfo info;
                            info.window = (AXUIElementRef)CFRetain(window);
                            info.pid = pid;
                            info.isExtension = isExtension;
                            info.width = static_cast<int>(size.width);
                            info.height = static_cast<int>(size.height);
                            windows.push_back(info);
                        }
                    }
                }
            }
            CFRelease(windowArray);
        }
        CFRelease(app);
        return windows;
    }

    bool ArrangeWindow(pid_t pid, float x, float y, float width, float height, bool preserveSize = false) {
        auto windows = GetWindowsForPid(pid);
        if (windows.empty()) {
            LOG_ERROR("No windows found for process");
            return false;
        }

        WindowInfo* mainWindow = nullptr;
        std::vector<WindowInfo*> extensionWindows;

        for (auto& window : windows) {
            if (!window.isExtension) {
                mainWindow = &window;
            } else {
                extensionWindows.push_back(&window);
            }
        }

        if (!mainWindow) {
            LOG_ERROR("Main window not found");
            return false;
        }

        // Position and size for main window
        CGPoint position = CGPointMake(x, y);
        AXValueRef positionRef = AXValueCreate((AXValueType)kAXValueCGPointType, &position);
        if (positionRef) {
            AXUIElementSetAttributeValue(mainWindow->window, kAXPositionAttribute, positionRef);
            CFRelease(positionRef);
        }

        if (!preserveSize) {
            CGSize size = CGSizeMake(width, height);
            AXValueRef sizeRef = AXValueCreate((AXValueType)kAXValueCGSizeType, &size);
            if (sizeRef) {
                AXUIElementSetAttributeValue(mainWindow->window, kAXSizeAttribute, sizeRef);
                CFRelease(sizeRef);
            }
        }

        // Bring main window to front
        BringWindowToFront(mainWindow->window);

        // Handle extension windows
        for (auto extWindow : extensionWindows) {
            // Position extension windows at the right edge of the main window
            CGPoint extPosition = CGPointMake(x + width - extWindow->width - 10, y);
            AXValueRef extPositionRef = AXValueCreate((AXValueType)kAXValueCGPointType, &extPosition);
            if (extPositionRef) {
                AXUIElementSetAttributeValue(extWindow->window, kAXPositionAttribute, extPositionRef);
                CFRelease(extPositionRef);
            }

            // Bring extension window to front
            BringWindowToFront(extWindow->window);
        }

        // Clean up
        for (auto& window : windows) {
            if (window.window) {
                CFRelease(window.window);
            }
        }

        return true;
    }
    #endif

    #ifdef _WIN32
    std::vector<MonitorInfo> GetMonitors() {
        std::vector<MonitorInfo> monitors;
        EnumDisplayMonitors(NULL, NULL, [](HMONITOR hMonitor, HDC, LPRECT, LPARAM lParam) -> BOOL {
            auto& monitors = *reinterpret_cast<std::vector<MonitorInfo>*>(lParam);
            MONITORINFOEX monitorInfo;
            monitorInfo.cbSize = sizeof(MONITORINFOEX);
            
            if (GetMonitorInfo(hMonitor, &monitorInfo)) {
                MonitorInfo info;
                info.handle = hMonitor;
                info.rect = monitorInfo.rcWork;
                info.isPrimary = (monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;
                monitors.push_back(info);
            }
            return TRUE;
        }, reinterpret_cast<LPARAM>(&monitors));
        
        // Sort monitors so that non-primary monitors come first
        std::sort(monitors.begin(), monitors.end(), 
            [](const MonitorInfo& a, const MonitorInfo& b) {
                return a.isPrimary < b.isPrimary;
            });
        
        return monitors;
    }
    #elif __APPLE__
    std::vector<MonitorInfo> GetMonitors() {
        std::vector<MonitorInfo> monitors;
        uint32_t displayCount;
        CGDirectDisplayID displays[32];
        
        if (CGGetActiveDisplayList(32, displays, &displayCount) == kCGErrorSuccess) {
            CGDirectDisplayID mainDisplay = CGMainDisplayID();
            
            for (uint32_t i = 0; i < displayCount; i++) {
                MonitorInfo info;
                info.id = displays[i];
                info.bounds = CGDisplayBounds(displays[i]);
                info.isPrimary = (displays[i] == mainDisplay);
                monitors.push_back(info);
            }
            
            // Sort monitors so that non-primary monitors come first
            std::sort(monitors.begin(), monitors.end(), 
                [](const MonitorInfo& a, const MonitorInfo& b) {
                    return a.isPrimary < b.isPrimary;
                });
        }
        
        return monitors;
    }
    #else
    // Linux implementation (returns empty - not supported)
    std::vector<MonitorInfo> GetMonitors() {
        return std::vector<MonitorInfo>();
    }
    #endif

    // Expose GetMonitors to JavaScript
    Napi::Value GetMonitorsJS(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Array result = Napi::Array::New(env);

        auto monitors = GetMonitors();

        for (size_t i = 0; i < monitors.size(); i++) {
            Napi::Object monitorObj = Napi::Object::New(env);

#ifdef _WIN32
            monitorObj.Set("x", Napi::Number::New(env, monitors[i].rect.left));
            monitorObj.Set("y", Napi::Number::New(env, monitors[i].rect.top));
            monitorObj.Set("width", Napi::Number::New(env, monitors[i].rect.right - monitors[i].rect.left));
            monitorObj.Set("height", Napi::Number::New(env, monitors[i].rect.bottom - monitors[i].rect.top));
#elif __APPLE__
            monitorObj.Set("x", Napi::Number::New(env, monitors[i].bounds.origin.x));
            monitorObj.Set("y", Napi::Number::New(env, monitors[i].bounds.origin.y));
            monitorObj.Set("width", Napi::Number::New(env, monitors[i].bounds.size.width));
            monitorObj.Set("height", Napi::Number::New(env, monitors[i].bounds.size.height));
#else
            monitorObj.Set("x", Napi::Number::New(env, monitors[i].x));
            monitorObj.Set("y", Napi::Number::New(env, monitors[i].y));
            monitorObj.Set("width", Napi::Number::New(env, monitors[i].width));
            monitorObj.Set("height", Napi::Number::New(env, monitors[i].height));
#endif
            monitorObj.Set("isPrimary", Napi::Boolean::New(env, monitors[i].isPrimary));
            monitorObj.Set("index", Napi::Number::New(env, i));

            result[i] = monitorObj;
        }

        return result;
    }

    Napi::Value ArrangeWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 5) {
            Napi::TypeError::New(env, "Wrong number of arguments");
            return env.Null();
        }

        int mainPid = info[0].As<Napi::Number>().Int32Value();
        Napi::Array childPidsArray = info[1].As<Napi::Array>();
        int columns = info[2].As<Napi::Number>().Int32Value();
        Napi::Object size = info[3].As<Napi::Object>();
        int spacing = info[4].As<Napi::Number>().Int32Value();

        // Optional 6th argument: monitor index (defaults to 0)
        int monitorIndex = 0;
        if (info.Length() >= 6 && info[5].IsNumber()) {
            monitorIndex = info[5].As<Napi::Number>().Int32Value();
        }

        int width = size.Get("width").As<Napi::Number>().Int32Value();
        int height = size.Get("height").As<Napi::Number>().Int32Value();

        std::vector<int> childPids;
        for (uint32_t i = 0; i < childPidsArray.Length(); i++) {
            childPids.push_back(childPidsArray.Get(i).As<Napi::Number>().Int32Value());
        }

        // Get all available monitors
        auto monitors = GetMonitors();
        if (monitors.empty()) {
            Napi::Error::New(env, "No monitors found");
            return env.Null();
        }

        // Validate monitor index
        if (monitorIndex < 0 || monitorIndex >= static_cast<int>(monitors.size())) {
            Napi::Error::New(env, "Invalid monitor index");
            return env.Null();
        }

#ifdef _WIN32
        // Use the selected monitor
        const auto& monitor = monitors[monitorIndex];
        int screenWidth = monitor.rect.right - monitor.rect.left;
        int screenHeight = monitor.rect.bottom - monitor.rect.top;
        int screenX = monitor.rect.left;
        int screenY = monitor.rect.top;

        // Calculate total windows and rows
        int totalWindows = childPids.size() + 1;
        int rows = (totalWindows + columns - 1) / columns;

        // Calculate effective dimensions with spacing
        int availableWidth = screenWidth - (spacing * (columns + 1));
        int availableHeight = screenHeight - (spacing * (rows + 1));
        int effectiveWidth = width > 0 ? width : availableWidth / columns;
        int effectiveHeight = height > 0 ? height : availableHeight / rows;

        // Handle main window and its extensions
        auto mainWindows = FindWindowsByPid(mainPid);
        WindowInfo* mainWindow = nullptr;
        std::vector<WindowInfo*> mainExtensions;

        for (auto& win : mainWindows) {
            if (!win.isExtension) {
                mainWindow = &win;
            } else {
                mainExtensions.push_back(&win);
            }
        }

        if (mainWindow) {
            int row = 0;
            int col = 0;
            int x = screenX + col * effectiveWidth + spacing;
            int y = screenY + row * effectiveHeight + spacing;
            ArrangeWindow(mainWindow->hwnd, x, y, effectiveWidth - spacing * 2, effectiveHeight - spacing * 2);

            for (auto ext : mainExtensions) {
                ArrangeWindow(ext->hwnd,
                            x + effectiveWidth - ext->width - spacing,
                            y,
                            ext->width,
                            ext->height,
                            true);
            }
        }

        // Handle child windows
        for (size_t i = 0; i < childPids.size(); i++) {
            auto childWindows = FindWindowsByPid(childPids[i]);
            WindowInfo* childMain = nullptr;
            std::vector<WindowInfo*> childExtensions;

            for (auto& win : childWindows) {
                if (!win.isExtension) {
                    childMain = &win;
                } else {
                    childExtensions.push_back(&win);
                }
            }

            if (childMain) {
                int row = (i + 1) / columns;
                int col = (i + 1) % columns;
                int x = screenX + (col * effectiveWidth) + (spacing * (col + 1));
                int y = screenY + (row * effectiveHeight) + (spacing * (row + 1));

                ArrangeWindow(childMain->hwnd,
                            x,
                            y,
                            effectiveWidth - spacing,
                            effectiveHeight - spacing);

                // Handle extensions
                for (auto ext : childExtensions) {
                    ArrangeWindow(ext->hwnd,
                                x + effectiveWidth - ext->width - spacing,
                                y,
                                ext->width,
                                ext->height,
                                true);
                }
            }
        }
#elif __APPLE__
        // Use the selected monitor
        const auto& monitor = monitors[monitorIndex];
        float screenWidth = monitor.bounds.size.width;
        float screenHeight = monitor.bounds.size.height;
        float screenX = monitor.bounds.origin.x;
        float screenY = monitor.bounds.origin.y;

        // Calculate total windows and rows
        int totalWindows = childPids.size() + 1;
        int rows = (totalWindows + columns - 1) / columns;

        // Calculate effective dimensions with spacing
        float availableWidth = screenWidth - (spacing * (columns + 1));
        float availableHeight = screenHeight - (spacing * (rows + 1));
        float effectiveWidth = width > 0 ? width : availableWidth / columns;
        float effectiveHeight = height > 0 ? height : availableHeight / rows;

        // Handle main window
        ArrangeWindow(mainPid, 
                     screenX + spacing, 
                     screenY + spacing, 
                     effectiveWidth - spacing * 2, 
                     effectiveHeight - spacing * 2);

        // Handle child windows
        for (size_t i = 0; i < childPids.size(); i++) {
            int row = (i + 1) / columns;
            int col = (i + 1) % columns;
            float x = screenX + (col * effectiveWidth) + (spacing * (col + 1));
            float y = screenY + (row * effectiveHeight) + (spacing * (row + 1));
            
            ArrangeWindow(childPids[i],
                         x,
                         y,
                         effectiveWidth - spacing,
                         effectiveHeight - spacing);
        }
#endif

        return env.Null();
    }

    // Get window bounds by PID
    Napi::Value GetWindowBounds(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        Napi::Object result = Napi::Object::New(env);

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (!windows.empty()) {
            WindowInfo* mainWindow = nullptr;
            for (auto& win : windows) {
                if (!win.isExtension) {
                    mainWindow = &win;
                    break;
                }
            }

            if (mainWindow) {
                RECT rect;
                if (GetWindowRect(mainWindow->hwnd, &rect)) {
                    result.Set("x", Napi::Number::New(env, rect.left));
                    result.Set("y", Napi::Number::New(env, rect.top));
                    result.Set("width", Napi::Number::New(env, rect.right - rect.left));
                    result.Set("height", Napi::Number::New(env, rect.bottom - rect.top));
                    result.Set("success", Napi::Boolean::New(env, true));
                }
            }
        }
#elif __APPLE__
        auto windows = GetWindowsForPid(pid);
        if (!windows.empty()) {
            WindowInfo* mainWindow = nullptr;
            for (auto& win : windows) {
                if (!win.isExtension) {
                    mainWindow = &win;
                    break;
                }
            }

            if (mainWindow) {
                CGPoint position;
                CGSize size;
                AXValueRef posRef, sizeRef;

                if (AXUIElementCopyAttributeValue(mainWindow->window, kAXPositionAttribute, (CFTypeRef*)&posRef) == kAXErrorSuccess) {
                    AXValueGetValue(posRef, (AXValueType)kAXValueCGPointType, &position);
                    CFRelease(posRef);

                    if (AXUIElementCopyAttributeValue(mainWindow->window, kAXSizeAttribute, (CFTypeRef*)&sizeRef) == kAXErrorSuccess) {
                        AXValueGetValue(sizeRef, (AXValueType)kAXValueCGSizeType, &size);
                        CFRelease(sizeRef);

                        result.Set("x", Napi::Number::New(env, position.x));
                        result.Set("y", Napi::Number::New(env, position.y));
                        result.Set("width", Napi::Number::New(env, size.width));
                        result.Set("height", Napi::Number::New(env, size.height));
                        result.Set("success", Napi::Boolean::New(env, true));
                    }
                }
                CFRelease(mainWindow->window);
            }
        }
#endif

        if (!result.Has("success")) {
            result.Set("success", Napi::Boolean::New(env, false));
        }

        return result;
    }

    // Get all windows for a process (including extension/popup windows)
    Napi::Value GetAllWindows(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments: expected pid");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        Napi::Array result = Napi::Array::New(env);

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        uint32_t index = 0;

        for (auto& win : windows) {
            RECT rect;
            if (GetWindowRect(win.hwnd, &rect)) {
                Napi::Object windowObj = Napi::Object::New(env);

                // Get window title
                char title[256] = {0};
                GetWindowTextA(win.hwnd, title, sizeof(title));

                windowObj.Set("x", Napi::Number::New(env, rect.left));
                windowObj.Set("y", Napi::Number::New(env, rect.top));
                windowObj.Set("width", Napi::Number::New(env, rect.right - rect.left));
                windowObj.Set("height", Napi::Number::New(env, rect.bottom - rect.top));
                windowObj.Set("isExtension", Napi::Boolean::New(env, win.isExtension));
                windowObj.Set("title", Napi::String::New(env, title));

                result[index++] = windowObj;
            }
        }
#elif __APPLE__
        auto windows = GetWindowsForPid(pid);
        uint32_t index = 0;

        for (auto& win : windows) {
            CGPoint position;
            CGSize size;
            AXValueRef posRef, sizeRef;

            if (AXUIElementCopyAttributeValue(win.window, kAXPositionAttribute, (CFTypeRef*)&posRef) == kAXErrorSuccess) {
                AXValueGetValue(posRef, (AXValueType)kAXValueCGPointType, &position);
                CFRelease(posRef);

                if (AXUIElementCopyAttributeValue(win.window, kAXSizeAttribute, (CFTypeRef*)&sizeRef) == kAXErrorSuccess) {
                    AXValueGetValue(sizeRef, (AXValueType)kAXValueCGSizeType, &size);
                    CFRelease(sizeRef);

                    Napi::Object windowObj = Napi::Object::New(env);

                    // Get window title
                    CFStringRef titleRef;
                    char title[256] = {0};
                    if (AXUIElementCopyAttributeValue(win.window, kAXTitleAttribute, (CFTypeRef*)&titleRef) == kAXErrorSuccess) {
                        CFStringGetCString(titleRef, title, sizeof(title), kCFStringEncodingUTF8);
                        CFRelease(titleRef);
                    }

                    windowObj.Set("x", Napi::Number::New(env, position.x));
                    windowObj.Set("y", Napi::Number::New(env, position.y));
                    windowObj.Set("width", Napi::Number::New(env, size.width));
                    windowObj.Set("height", Napi::Number::New(env, size.height));
                    windowObj.Set("isExtension", Napi::Boolean::New(env, win.isExtension));
                    windowObj.Set("title", Napi::String::New(env, title));

                    result[index++] = windowObj;
                }
            }

            CFRelease(win.window);
        }
#endif

        return result;
    }

    // Send mouse event to window
    Napi::Value SendMouseEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 4) {
            Napi::TypeError::New(env, "Wrong number of arguments: pid, x, y, eventType");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        int x = info[1].As<Napi::Number>().Int32Value();
        int y = info[2].As<Napi::Number>().Int32Value();
        std::string eventType = info[3].As<Napi::String>().Utf8Value();

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (windows.empty()) {
            return Napi::Boolean::New(env, false);
        }

        WindowInfo* mainWindow = nullptr;
        for (auto& win : windows) {
            if (!win.isExtension) {
                mainWindow = &win;
                break;
            }
        }

        if (!mainWindow) {
            return Napi::Boolean::New(env, false);
        }

        // Check if click position is on an extension window first
        // Extension windows are independent windows (e.g., OKX Wallet popup)
        HWND targetWindow = mainWindow->hwnd;

        for (auto& win : windows) {
            if (win.isExtension) {
                RECT extRect;
                GetWindowRect(win.hwnd, &extRect);

                if (x >= extRect.left && x <= extRect.right &&
                    y >= extRect.top && y <= extRect.bottom) {
                    targetWindow = win.hwnd;
                    break;
                }
            }
        }

        // If not in extension window, check popup windows (menus, dropdowns, etc.)
        if (targetWindow == mainWindow->hwnd) {
            std::vector<HWND> popupWindows = FindPopupWindows(pid);

            for (HWND popup : popupWindows) {
                RECT popupRect;
                GetWindowRect(popup, &popupRect);

                if (x >= popupRect.left && x <= popupRect.right &&
                    y >= popupRect.top && y <= popupRect.bottom) {
                    targetWindow = popup;
                    break;
                }
            }
        }

        // Calculate coordinates relative to target window
        RECT rect;
        GetWindowRect(targetWindow, &rect);
        int clientX = x - rect.left;
        int clientY = y - rect.top;
        LPARAM lParam = MAKELPARAM(clientX, clientY);

        // Send event to target window (either main window or popup)
        if (eventType == "mousemove") {
            PostMessage(targetWindow, WM_MOUSEMOVE, 0, lParam);
        } else if (eventType == "mousedown") {
            PostMessage(targetWindow, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
        } else if (eventType == "mouseup") {
            PostMessage(targetWindow, WM_LBUTTONUP, 0, lParam);
        } else if (eventType == "rightdown") {
            PostMessage(targetWindow, WM_RBUTTONDOWN, MK_RBUTTON, lParam);
        } else if (eventType == "rightup") {
            PostMessage(targetWindow, WM_RBUTTONUP, 0, lParam);
        } else {
            return Napi::Boolean::New(env, false);
        }

#elif __APPLE__
        CGPoint point = CGPointMake(x, y);
        CGEventType cgEventType;
        CGMouseButton button = kCGMouseButtonLeft;

        if (eventType == "mousemove") {
            cgEventType = kCGEventMouseMoved;
        } else if (eventType == "mousedown") {
            cgEventType = kCGEventLeftMouseDown;
        } else if (eventType == "mouseup") {
            cgEventType = kCGEventLeftMouseUp;
        } else if (eventType == "rightdown") {
            cgEventType = kCGEventRightMouseDown;
            button = kCGMouseButtonRight;
        } else if (eventType == "rightup") {
            cgEventType = kCGEventRightMouseUp;
            button = kCGMouseButtonRight;
        } else {
            return Napi::Boolean::New(env, false);
        }

        CGEventRef event = CGEventCreateMouseEvent(NULL, cgEventType, point, button);
        if (event) {
            CGEventSetIntegerValueField(event, kCGEventSourceUserData, kChromePowerSyntheticEventMarker);
            CGEventPostToPid(pid, event);
            CFRelease(event);
        }
#endif

        return Napi::Boolean::New(env, true);
    }

    // Send keyboard event to window
    // Now supports automatic popup window detection based on mouse position
    Napi::Value SendKeyboardEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Wrong number of arguments: pid, keyCode, eventType, [mouseX, mouseY]");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        int keyCode = info[1].As<Napi::Number>().Int32Value();
        std::string eventType = info[2].As<Napi::String>().Utf8Value();

        // Optional mouse position for popup detection
        int mouseX = -1;
        int mouseY = -1;
        if (info.Length() >= 5) {
            mouseX = info[3].As<Napi::Number>().Int32Value();
            mouseY = info[4].As<Napi::Number>().Int32Value();
        }

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (windows.empty()) {
            return Napi::Boolean::New(env, false);
        }

        WindowInfo* mainWindow = nullptr;
        for (auto& win : windows) {
            if (!win.isExtension) {
                mainWindow = &win;
                break;
            }
        }

        if (!mainWindow) {
            return Napi::Boolean::New(env, false);
        }

        // Detect extension/popup windows if mouse position provided
        HWND targetWindow = mainWindow->hwnd;

        if (mouseX >= 0 && mouseY >= 0) {
            char debugMsg[512];
            sprintf_s(debugMsg, "[Keyboard] PID %d: Mouse at (%d, %d), checking windows",
                     pid, mouseX, mouseY);
            OutputDebugStringA(debugMsg);

            // First check extension windows (independent windows like OKX Wallet)
            bool foundWindow = false;
            for (auto& win : windows) {
                if (win.isExtension) {
                    RECT extRect;
                    GetWindowRect(win.hwnd, &extRect);

                    sprintf_s(debugMsg, "[Keyboard]   Checking extension window bounds [%d, %d, %d, %d]",
                             extRect.left, extRect.top, extRect.right, extRect.bottom);
                    OutputDebugStringA(debugMsg);

                    if (mouseX >= extRect.left && mouseX <= extRect.right &&
                        mouseY >= extRect.top && mouseY <= extRect.bottom) {
                        targetWindow = win.hwnd;
                        foundWindow = true;
                        sprintf_s(debugMsg, "[Keyboard]   [OK] Mouse in extension window! Routing to extension");
                        OutputDebugStringA(debugMsg);
                        break;
                    }
                }
            }

            // If not in extension window, check popup windows (menus, dropdowns, etc.)
            if (!foundWindow) {
                std::vector<HWND> popupWindows = FindPopupWindows(pid);
                sprintf_s(debugMsg, "[Keyboard]   Found %zu popup windows", popupWindows.size());
                OutputDebugStringA(debugMsg);

                for (HWND popup : popupWindows) {
                    RECT popupRect;
                    GetWindowRect(popup, &popupRect);

                    sprintf_s(debugMsg, "[Keyboard]   Checking popup bounds [%d, %d, %d, %d]",
                             popupRect.left, popupRect.top, popupRect.right, popupRect.bottom);
                    OutputDebugStringA(debugMsg);

                    if (mouseX >= popupRect.left && mouseX <= popupRect.right &&
                        mouseY >= popupRect.top && mouseY <= popupRect.bottom) {
                        targetWindow = popup;
                        foundWindow = true;
                        sprintf_s(debugMsg, "[Keyboard]   [OK] Mouse in popup! Routing to popup window");
                        OutputDebugStringA(debugMsg);
                        break;
                    }
                }
            }

            if (!foundWindow) {
                sprintf_s(debugMsg, "[Keyboard]   [X] Mouse not in any extension/popup, using main window");
                OutputDebugStringA(debugMsg);
            }
        }

        // Build lParam for extended keys
        // Bit 24: Extended-key flag (1 for extended keys like arrows, Insert, Delete, etc.)
        // Check if this is an extended key based on the VK code
        bool isExtendedKey = (
            keyCode == VK_INSERT || keyCode == VK_DELETE || keyCode == VK_HOME ||
            keyCode == VK_END || keyCode == VK_PRIOR || keyCode == VK_NEXT ||
            keyCode == VK_LEFT || keyCode == VK_UP || keyCode == VK_RIGHT || keyCode == VK_DOWN ||
            keyCode == VK_NUMLOCK || keyCode == VK_DIVIDE
        );

        LPARAM lParam = 1; // Repeat count = 1
        if (isExtendedKey) {
            lParam |= (1 << 24); // Set extended-key flag
        }

        if (eventType == "keydown") {
            PostMessage(targetWindow, WM_KEYDOWN, keyCode, lParam);
        } else if (eventType == "keyup") {
            lParam |= (1 << 30); // Previous key state (1 = key was down)
            lParam |= (1 << 31); // Transition state (1 = key is being released)
            PostMessage(targetWindow, WM_KEYUP, keyCode, lParam);
        }

#elif __APPLE__
        CGEventRef event;
        bool isKeyDown = (eventType == "keydown");
        CGEventFlags flags = 0;
        if (info.Length() >= 6 && info[5].IsNumber()) {
            flags = static_cast<CGEventFlags>(info[5].As<Napi::Number>().Int64Value());
        }

        event = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, isKeyDown);
        if (event) {
            CGEventSetIntegerValueField(event, kCGEventSourceUserData, kChromePowerSyntheticEventMarker);
            CGEventSetFlags(event, flags);
            if (info.Length() >= 7 && info[6].IsString()) {
                std::u16string text = info[6].As<Napi::String>().Utf16Value();
                if (!text.empty()) {
                    CGEventKeyboardSetUnicodeString(
                        event,
                        text.size(),
                        reinterpret_cast<const UniChar*>(text.data())
                    );
                }
            }
            // Send keyboard event directly to target process to avoid affecting global system
            CGEventPostToPid(pid, event);
            CFRelease(event);
        }
#endif

        return Napi::Boolean::New(env, true);
    }

    // Send keyboard event to extension window by title
    Napi::Value SendKeyboardEventToExtension(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 4) {
            Napi::TypeError::New(env, "Wrong number of arguments: pid, windowTitle, keyCode, eventType");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        std::string windowTitle = info[1].As<Napi::String>().Utf8Value();
        int keyCode = info[2].As<Napi::Number>().Int32Value();
        std::string eventType = info[3].As<Napi::String>().Utf8Value();

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (windows.empty()) {
            return Napi::Boolean::New(env, false);
        }

        // Find extension window with matching title
        WindowInfo* targetWindow = nullptr;
        for (auto& win : windows) {
            if (win.isExtension) {
                char title[256] = {0};
                GetWindowTextA(win.hwnd, title, sizeof(title));
                if (std::string(title) == windowTitle) {
                    targetWindow = &win;
                    break;
                }
            }
        }

        if (!targetWindow) {
            // Window not found, return false but don't error
            return Napi::Boolean::New(env, false);
        }

        // Build lParam for extended keys
        bool isExtendedKey = (
            keyCode == VK_INSERT || keyCode == VK_DELETE || keyCode == VK_HOME ||
            keyCode == VK_END || keyCode == VK_PRIOR || keyCode == VK_NEXT ||
            keyCode == VK_LEFT || keyCode == VK_UP || keyCode == VK_RIGHT || keyCode == VK_DOWN ||
            keyCode == VK_NUMLOCK || keyCode == VK_DIVIDE
        );

        LPARAM lParam = 1; // Repeat count = 1
        if (isExtendedKey) {
            lParam |= (1 << 24); // Set extended-key flag
        }

        if (eventType == "keydown") {
            PostMessage(targetWindow->hwnd, WM_KEYDOWN, keyCode, lParam);
        } else if (eventType == "keyup") {
            lParam |= (1 << 30); // Previous key state (1 = key was down)
            lParam |= (1 << 31); // Transition state (1 = key is being released)
            PostMessage(targetWindow->hwnd, WM_KEYUP, keyCode, lParam);
        }

#elif __APPLE__
        // For macOS, we can't easily send keyboard events to specific windows
        // Fall back to global keyboard events
        CGEventRef event;
        bool isKeyDown = (eventType == "keydown");

        event = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, isKeyDown);
        if (event) {
            CGEventSetIntegerValueField(event, kCGEventSourceUserData, kChromePowerSyntheticEventMarker);
            CGEventPost(kCGHIDEventTap, event);
            CFRelease(event);
        }
#endif

        return Napi::Boolean::New(env, true);
    }

    // Send wheel event to window
    Napi::Value SendWheelEvent(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Wrong number of arguments: pid, deltaX, deltaY, [x, y]");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();
        int deltaX = info[1].As<Napi::Number>().Int32Value();
        int deltaY = info[2].As<Napi::Number>().Int32Value();

        // Optional x, y coordinates (screen coordinates)
        // If not provided, use current cursor position
        int cursorX, cursorY;
        if (info.Length() >= 5) {
            cursorX = info[3].As<Napi::Number>().Int32Value();
            cursorY = info[4].As<Napi::Number>().Int32Value();
        } else {
#ifdef _WIN32
            POINT cursorPos;
            GetCursorPos(&cursorPos);
            cursorX = cursorPos.x;
            cursorY = cursorPos.y;
#else
            cursorX = 0;
            cursorY = 0;
#endif
        }

#ifdef _WIN32
        auto windows = FindWindowsByPid(pid);
        if (windows.empty()) {
            return Napi::Boolean::New(env, false);
        }

        WindowInfo* mainWindow = nullptr;
        for (auto& win : windows) {
            if (!win.isExtension) {
                mainWindow = &win;
                break;
            }
        }

        if (!mainWindow) {
            return Napi::Boolean::New(env, false);
        }

        // Send wheel event
        // Note: deltaY is already multiplied by WHEEL_DELTA (120) in TypeScript

        // WM_MOUSEWHEEL: wParam = key state | delta, lParam = screen coords
        WPARAM wParam = MAKEWPARAM(0, deltaY);
        LPARAM lParam = MAKELPARAM(cursorX, cursorY);

        // Use SendMessage instead of PostMessage for better reliability
        SendMessage(mainWindow->hwnd, WM_MOUSEWHEEL, wParam, lParam);

#elif __APPLE__
        CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, deltaY, deltaX);
        if (event) {
            CGEventSetIntegerValueField(event, kCGEventSourceUserData, kChromePowerSyntheticEventMarker);
            // Send scroll event directly to target process
            CGEventPostToPid(pid, event);
            CFRelease(event);
        }
#endif

        return Napi::Boolean::New(env, true);
    }

    // Check if any window from the given process is currently active (foreground)
    Napi::Value IsProcessWindowActive(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Wrong number of arguments: pid");
        }

        int pid = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
        // Get the current foreground window
        HWND foregroundWindow = GetForegroundWindow();
        if (!foregroundWindow) {
            return Napi::Boolean::New(env, false);
        }

        // Get the process ID of the foreground window
        DWORD foregroundPid = 0;
        GetWindowThreadProcessId(foregroundWindow, &foregroundPid);

        // Check if it matches our target PID
        bool isActive = (foregroundPid == static_cast<DWORD>(pid));

        return Napi::Boolean::New(env, isActive);

#elif __APPLE__
        // Get the active application
        @autoreleasepool {
            NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
            if (!frontApp) {
                return Napi::Boolean::New(env, false);
            }

            pid_t frontPid = [frontApp processIdentifier];
            bool isActive = (frontPid == pid);

            return Napi::Boolean::New(env, isActive);
        }
#else
        return Napi::Boolean::New(env, false);
#endif
    }

    // Send mouse event with popup window matching
    // This finds and matches popup windows between master and slave processes
    Napi::Value SendMouseEventWithPopupMatching(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 5) {
            Napi::TypeError::New(env, "Wrong number of arguments: masterPid, slavePid, x, y, eventType");
        }

        int masterPid = info[0].As<Napi::Number>().Int32Value();
        int slavePid = info[1].As<Napi::Number>().Int32Value();
        int x = info[2].As<Napi::Number>().Int32Value();
        int y = info[3].As<Napi::Number>().Int32Value();
        std::string eventType = info[4].As<Napi::String>().Utf8Value();

#ifdef _WIN32
        // Find main windows
        auto masterWindows = FindWindowsByPid(masterPid);
        auto slaveWindows = FindWindowsByPid(slavePid);

        if (masterWindows.empty() || slaveWindows.empty()) {
            return Napi::Boolean::New(env, false);
        }

        WindowInfo* masterMainWindow = nullptr;
        WindowInfo* slaveMainWindow = nullptr;

        for (auto& win : masterWindows) {
            if (!win.isExtension) {
                masterMainWindow = &win;
                break;
            }
        }

        for (auto& win : slaveWindows) {
            if (!win.isExtension) {
                slaveMainWindow = &win;
                break;
            }
        }

        if (!masterMainWindow || !slaveMainWindow) {
            return Napi::Boolean::New(env, false);
        }

        // Find popup windows
        std::vector<HWND> masterPopups = FindPopupWindows(masterPid);
        std::vector<HWND> slavePopups = FindPopupWindows(slavePid);

        // Debug: Log popup window counts
        char debugMsg[256];
        sprintf_s(debugMsg, "[C++] Found %zu master popups, %zu slave popups for event '%s'",
                 masterPopups.size(), slavePopups.size(), eventType.c_str());
        OutputDebugStringA(debugMsg);

        // Check if click is on a master popup window
        HWND masterClickedPopup = nullptr;
        for (HWND popup : masterPopups) {
            RECT popupRect;
            GetWindowRect(popup, &popupRect);

            if (x >= popupRect.left && x <= popupRect.right &&
                y >= popupRect.top && y <= popupRect.bottom) {
                masterClickedPopup = popup;
                sprintf_s(debugMsg, "[C++] Click on master popup at (%d, %d)", x, y);
                OutputDebugStringA(debugMsg);
                break;
            }
        }

        HWND targetWindow = slaveMainWindow->hwnd;
        int targetX = x;
        int targetY = y;

        // If clicked on a popup, find matching slave popup
        if (masterClickedPopup) {
            HWND matchingSlavePopup = FindMatchingPopup(
                masterMainWindow->hwnd, masterClickedPopup,
                slaveMainWindow->hwnd, slavePopups);

            if (matchingSlavePopup) {
                targetWindow = matchingSlavePopup;

                // Calculate coordinates relative to the popup window
                RECT masterPopupRect, slavePopupRect;
                GetWindowRect(masterClickedPopup, &masterPopupRect);
                GetWindowRect(matchingSlavePopup, &slavePopupRect);

                // Convert master coordinates to relative position within popup
                int relX = x - masterPopupRect.left;
                int relY = y - masterPopupRect.top;

                // Apply to slave popup
                targetX = slavePopupRect.left + relX;
                targetY = slavePopupRect.top + relY;
            }
        } else {
            // No popup clicked, calculate position for slave main window
            RECT masterMainRect, slaveMainRect;
            GetWindowRect(masterMainWindow->hwnd, &masterMainRect);
            GetWindowRect(slaveMainWindow->hwnd, &slaveMainRect);

            // Calculate relative position in master window
            double relX = (double)(x - masterMainRect.left) / (masterMainRect.right - masterMainRect.left);
            double relY = (double)(y - masterMainRect.top) / (masterMainRect.bottom - masterMainRect.top);

            // Apply to slave window
            targetX = slaveMainRect.left + (int)(relX * (slaveMainRect.right - slaveMainRect.left));
            targetY = slaveMainRect.top + (int)(relY * (slaveMainRect.bottom - slaveMainRect.top));
        }

        // Calculate client coordinates relative to target window
        RECT targetRect;
        GetWindowRect(targetWindow, &targetRect);
        int clientX = targetX - targetRect.left;
        int clientY = targetY - targetRect.top;
        LPARAM lParam = MAKELPARAM(clientX, clientY);

        // For right-click events, we need to move the cursor to ensure Chrome's GetCursorPos()
        // returns the correct position for context menu display
        // Strategy: For each window independently:
        // - Move cursor to target position
        // - Wait for system to recognize position
        // - Send message synchronously (SendMessage)
        // - Wait for Chrome to process and call GetCursorPos()
        // - Restore cursor to original position
        // This is called separately for each slave window
        bool isRightClick = (eventType == "rightdown" || eventType == "rightup");

        POINT originalCursorPos;
        if (isRightClick) {
            // Save current cursor position before any movement
            GetCursorPos(&originalCursorPos);

            // Move cursor to target position (screen coordinates)
            SetCursorPos(targetX, targetY);

            // Longer delay to ensure system and Chrome recognize the cursor position
            // Chrome calls GetCursorPos() when handling right-click events
            Sleep(15);

            sprintf_s(debugMsg, "[C++] Moved cursor from (%ld, %ld) to (%d, %d) for %s",
                     originalCursorPos.x, originalCursorPos.y, targetX, targetY, eventType.c_str());
            OutputDebugStringA(debugMsg);
        }

        // Send event - use SendMessage (synchronous) for right-click to ensure processing
        if (eventType == "mousemove") {
            PostMessage(targetWindow, WM_MOUSEMOVE, 0, lParam);
        } else if (eventType == "mousedown") {
            PostMessage(targetWindow, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
        } else if (eventType == "mouseup") {
            PostMessage(targetWindow, WM_LBUTTONUP, 0, lParam);
        } else if (eventType == "rightdown") {
            // Use SendMessage (sync) to ensure message is processed before continuing
            SendMessage(targetWindow, WM_RBUTTONDOWN, MK_RBUTTON, lParam);

            // Wait a bit before restoring to ensure Chrome has time to process
            Sleep(10);
            SetCursorPos(originalCursorPos.x, originalCursorPos.y);

            sprintf_s(debugMsg, "[C++] Sent WM_RBUTTONDOWN, restored cursor to (%ld, %ld)",
                     originalCursorPos.x, originalCursorPos.y);
            OutputDebugStringA(debugMsg);
        } else if (eventType == "rightup") {
            // Use SendMessage (sync) to ensure message is processed
            SendMessage(targetWindow, WM_RBUTTONUP, 0, lParam);

            // Wait longer for context menu to be triggered before restoring cursor
            // Chrome needs time to process the right-click and call GetCursorPos()
            // The menu appears during rightup processing
            Sleep(50);

            SetCursorPos(originalCursorPos.x, originalCursorPos.y);

            sprintf_s(debugMsg, "[C++] Restored cursor to (%ld, %ld) after rightup + 50ms delay",
                     originalCursorPos.x, originalCursorPos.y);
            OutputDebugStringA(debugMsg);
        } else {
            return Napi::Boolean::New(env, false);
        }

#elif __APPLE__
        // TODO: Implement for macOS
        return Napi::Boolean::New(env, false);
#endif

        return Napi::Boolean::New(env, true);
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return WindowManager::Init(env, exports);
}

NODE_API_MODULE(window_addon, Init)

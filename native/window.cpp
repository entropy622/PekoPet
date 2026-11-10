#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include "peko.h"
#include <windows.h>
#include <string>

extern "C" {
void peko_test_window(intptr_t handle){
    HWND hwnd=(HWND)handle;
    LONG_PTR style=GetWindowLongPtrW(hwnd,GWL_EXSTYLE);
    SetWindowLongPtrW(hwnd,GWL_EXSTYLE,(style&~WS_EX_APPWINDOW)|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW);
    SetWindowPos(hwnd,HWND_NOTOPMOST,-30000,-30000,0,0,SWP_NOSIZE|SWP_NOACTIVATE|SWP_FRAMECHANGED);
    ShowWindow(hwnd,SW_SHOWNOACTIVATE);
}
intptr_t peko_window_icon(intptr_t handle,const char* file){
    int count=MultiByteToWideChar(CP_UTF8,0,file,-1,nullptr,0);if(!count)return 0;
    std::wstring wide(count,L'\0');MultiByteToWideChar(CP_UTF8,0,file,-1,wide.data(),count);
    HICON icon=(HICON)LoadImageW(nullptr,wide.c_str(),IMAGE_ICON,0,0,LR_LOADFROMFILE|LR_DEFAULTSIZE);
    if(icon&&handle){SendMessageW((HWND)handle,WM_SETICON,ICON_SMALL,(LPARAM)icon);SendMessageW((HWND)handle,WM_SETICON,ICON_BIG,(LPARAM)icon);}return (intptr_t)icon;
}
void peko_release_icon(intptr_t icon){if(icon)DestroyIcon((HICON)icon);}
}

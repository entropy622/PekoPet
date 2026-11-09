#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include "peko.h"
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <dcomp.h>
#include <wrl/client.h>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <malloc.h>
#include "peko_shaders.h"
#include <CubismFramework.hpp>
#include <ICubismAllocator.hpp>
#include <CubismModelSettingJson.hpp>
#include <Model/CubismUserModel.hpp>
#include <Model/CubismModel.hpp>
#include <Math/CubismModelMatrix.hpp>
#include <Id/CubismIdManager.hpp>
#include <Id/CubismId.hpp>
#include <Motion/CubismMotionManager.hpp>
#include <Motion/CubismExpressionMotion.hpp>
#include <Effect/CubismEyeBlink.hpp>
#include <Effect/CubismBreath.hpp>
#include <Physics/CubismPhysics.hpp>
#include <Effect/CubismPose.hpp>
#include <Rendering/D3D11/CubismRenderer_D3D11.hpp>

using namespace Live2D::Cubism::Framework;
using namespace Live2D::Cubism::Framework::Rendering;
using Microsoft::WRL::ComPtr;
namespace fs=std::filesystem;
static thread_local std::string last_error;
static void check(HRESULT hr,const char* what){if(FAILED(hr))throw std::runtime_error(std::string(what)+" HRESULT="+std::to_string((unsigned long)hr));}
static std::vector<csmByte> bytes(const fs::path& p){std::ifstream f(p,std::ios::binary);if(!f)throw std::runtime_error("Cannot open "+p.string());return {std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>()};}
static fs::path path(const char* s){return fs::u8path(s);}
struct Allocator:ICubismAllocator{
    void* Allocate(csmSizeType n)override{return malloc(n);} void Deallocate(void* p)override{free(p);}
    void* AllocateAligned(csmSizeType n,csmUint32 a)override{return _aligned_malloc(n,a);}
    void DeallocateAligned(void* p)override{_aligned_free(p);}
};
static Allocator allocator;
static csmByte* loadShader(const std::string file,csmSizeInt* size){
    const char* source=file=="FrameworkShaders/CubismEffect.fx"?PEKO_EFFECT_SHADER:file=="FrameworkShaders/CubismBlendMode.fx"?PEKO_BLEND_SHADER:nullptr;
    if(!source){*size=0;return nullptr;}*size=(csmSizeInt)std::strlen(source);auto data=new csmByte[*size];std::memcpy(data,source,*size);return data;
}
static void releaseShader(csmByte* data){delete[] data;}

class Model:public CubismUserModel{
public:
    void load(const fs::path& file){
        auto json=bytes(file);setting=std::make_unique<CubismModelSettingJson>(json.data(),(csmSizeInt)json.size());base=file.parent_path();
        auto moc=bytes(base/path(setting->GetModelFileName()));LoadModel(moc.data(),(csmSizeInt)moc.size(),true);
        if(!_model)throw std::runtime_error("Cubism model load failed");
        if(*setting->GetPhysicsFileName()){auto b=bytes(base/path(setting->GetPhysicsFileName()));LoadPhysics(b.data(),(csmSizeInt)b.size());}
        if(*setting->GetPoseFileName()){auto b=bytes(base/path(setting->GetPoseFileName()));LoadPose(b.data(),(csmSizeInt)b.size());}
        _eyeBlink=CubismEyeBlink::Create(setting.get());_breath=CubismBreath::Create();
        csmVector<CubismBreath::BreathParameterData> bp;
        bp.PushBack({CubismFramework::GetIdManager()->GetId("ParamBreath"),0.5f,0.5f,3.2f,1.0f});_breath->SetParameters(bp);
        _model->SaveParameters();
    }
    void motion(const fs::path& file){auto b=bytes(file);auto m=LoadMotion(b.data(),(csmSizeInt)b.size(),"peko");if(!m)throw std::runtime_error("Cannot load motion");_motionManager->StartMotionPriority(m,true,3);}
    void cancel(){_motionManager->StopAllMotions();for(int i=0;i<_model->GetParameterCount();++i)_model->SetParameterValue(i,_model->GetParameterDefaultValue(i));_model->SaveParameters();}
    void update(float dt,float gazeX,float gazeY){
        _model->LoadParameters();_motionManager->UpdateMotion(_model,dt);_model->SaveParameters();
        if(_eyeBlink)_eyeBlink->UpdateParameters(_model,dt);if(_breath)_breath->UpdateParameters(_model,dt);
        auto id=CubismFramework::GetIdManager();
        _model->AddParameterValue(id->GetId("ParamAngleX"),gazeX*15);_model->AddParameterValue(id->GetId("ParamAngleY"),gazeY*10);
        _model->SetParameterValue(id->GetId("ParamEyeBallX"),gazeX);_model->SetParameterValue(id->GetId("ParamEyeBallY"),gazeY);
        float ease=1.0f-std::exp(-dt/0.12f);
        struct Blend{float add=0,multiply=1,overwrite=0,weight=0;};
        std::map<CubismIdHandle,Blend> blend;
        for(auto& [file,e]:expressions){
            e.weight+=(e.target-e.weight)*ease;if(e.weight<0.0001f)continue;
            auto ps=e.motion->GetExpressionParameters();
            for(csmInt32 i=0;i<ps.GetSize();++i){auto p=ps[i];
                auto& b=blend[p.ParameterId];
                if(p.BlendType==CubismExpressionMotion::Additive)b.add+=p.Value*e.weight;
                else if(p.BlendType==CubismExpressionMotion::Multiply)b.multiply*=1+(p.Value-1)*e.weight;
                else{b.overwrite+=p.Value*e.weight;b.weight+=e.weight;}
            }
        }
        for(auto& [parameter,b]:blend){float value=(_model->GetParameterValue(parameter)+b.add)*b.multiply;if(b.weight>0){float w=std::min(b.weight,1.f);value=value*(1-w)+(b.overwrite/b.weight)*w;}_model->SetParameterValue(parameter,value);}
        for(auto& [key,p]:parameters){p.weight+=(p.target-p.weight)*ease;if(p.weight>0.0001f)_model->SetParameterValue(id->GetId(key.c_str()),p.value,p.weight);}
        if(_physics)_physics->Evaluate(_model,dt);if(_pose)_pose->UpdateParameters(_model,dt);_model->Update();
    }
    struct Expr{CubismExpressionMotion* motion;float target=0,weight=0;};
    struct Param{float value=0,target=0,weight=0;};
    std::map<std::string,Expr> expressions;
    std::map<std::string,Param> parameters;
    std::unique_ptr<CubismModelSettingJson> setting;
    fs::path base;
    ~Model(){for(auto& [k,e]:expressions)ACubismMotion::Delete(e.motion);}
};

struct Pet{
    HWND hwnd=nullptr;PekoRect state{};POINT drag{},start{};bool dragging=false,moved=false;int events=0;
    ComPtr<ID3D11Device> device;ComPtr<ID3D11DeviceContext> context;ComPtr<IDXGISwapChain1> swap;
    ComPtr<ID3D11RenderTargetView> target;ComPtr<IDCompositionDevice> composition;ComPtr<IDCompositionTarget> compTarget;ComPtr<IDCompositionVisual> visual;
    std::vector<ComPtr<ID3D11ShaderResourceView>> textures;std::unique_ptr<Model> model;
    NOTIFYICONDATAW tray{};bool frameworkStarted=false,comStarted=false;CubismFramework::Option option;char monitorName[128]{};int dpi=96;
    void place(){
        RECT work{},bounds{state.x,state.y,state.x+state.width,state.y+state.height};HMONITOR monitor=MonitorFromRect(&bounds,MONITOR_DEFAULTTONEAREST);
        MONITORINFOEXW info{};info.cbSize=sizeof(info);GetMonitorInfoW(monitor,&info);work=info.rcWork;
        WideCharToMultiByte(CP_UTF8,0,info.szDevice,-1,monitorName,sizeof(monitorName),nullptr,nullptr);
        dpi=GetDpiForWindow(hwnd);if(!dpi)dpi=96;
        state.x=std::clamp<int>(state.x,work.left,std::max<int>(work.left,work.right-state.width));state.y=std::clamp<int>(state.y,work.top,std::max<int>(work.top,work.bottom-state.height));
        LONG_PTR ex=WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|WS_EX_NOREDIRECTIONBITMAP;
        if(state.through)ex|=WS_EX_TRANSPARENT;
        SetWindowLongPtrW(hwnd,GWL_EXSTYLE,ex);
        SetWindowPos(hwnd,state.topmost?HWND_TOPMOST:HWND_NOTOPMOST,state.x,state.y,state.width,state.height,SWP_NOACTIVATE|SWP_FRAMECHANGED);
        ShowWindow(hwnd,state.visible?SW_SHOWNOACTIVATE:SW_HIDE);
    }
    void menu(){
        HMENU m=CreatePopupMenu();AppendMenuW(m,MF_STRING,1,L"打开聊天  Ctrl+Alt+P");
        AppendMenuW(m,MF_STRING|(state.through?MF_CHECKED:0),2,L"鼠标穿透  Ctrl+Alt+Shift+P");
        AppendMenuW(m,MF_STRING|(state.topmost?MF_CHECKED:0),3,L"始终置顶");
        AppendMenuW(m,MF_STRING,4,state.visible?L"隐藏桌宠":L"显示桌宠");
        AppendMenuW(m,MF_SEPARATOR,0,nullptr);AppendMenuW(m,MF_STRING,5,L"退出 PekoPet");
        POINT p;GetCursorPos(&p);SetForegroundWindow(hwnd);int action=TrackPopupMenu(m,TPM_RETURNCMD|TPM_RIGHTBUTTON,p.x,p.y,0,hwnd,nullptr);DestroyMenu(m);
        if(action==1)events|=1;if(action==2){state.through=!state.through;place();events|=4;}
        if(action==3){state.topmost=!state.topmost;place();events|=4;}if(action==4){state.visible=!state.visible;place();}
        if(action==5)events|=2;
    }
    static LRESULT CALLBACK proc(HWND hwnd,UINT msg,WPARAM w,LPARAM l){
        auto p=(Pet*)GetWindowLongPtrW(hwnd,GWLP_USERDATA);
        if(msg==WM_NCCREATE){p=(Pet*)((CREATESTRUCTW*)l)->lpCreateParams;SetWindowLongPtrW(hwnd,GWLP_USERDATA,(LONG_PTR)p);}
        if(!p)return DefWindowProcW(hwnd,msg,w,l);
        switch(msg){
            case WM_MOUSEACTIVATE:return MA_NOACTIVATE;
            case WM_LBUTTONDOWN:GetCursorPos(&p->drag);p->start={p->state.x,p->state.y};p->dragging=true;p->moved=false;SetCapture(hwnd);return 0;
            case WM_MOUSEMOVE:p->events|=8;if(p->dragging){POINT now;GetCursorPos(&now);p->state.x=p->start.x+now.x-p->drag.x;p->state.y=p->start.y+now.y-p->drag.y;if(abs(now.x-p->drag.x)+abs(now.y-p->drag.y)>4)p->moved=true;p->place();}return 0;
            case WM_LBUTTONUP:if(p->dragging){p->dragging=false;ReleaseCapture();p->events|=p->moved?4:1;}return 0;
            case WM_MOUSEWHEEL:p->state.scale=std::clamp(p->state.scale+(float)GET_WHEEL_DELTA_WPARAM(w)/1200.f,0.1f,4.f);p->events|=4;return 0;
            case WM_RBUTTONUP:p->menu();return 0;
            case WM_HOTKEY:if(w==1)p->events|=1;else{p->state.through=!p->state.through;p->place();p->events|=4;}return 0;
            case WM_APP+1:if(l==WM_LBUTTONUP||l==NIN_BALLOONUSERCLICK)p->events|=1;if(l==WM_RBUTTONUP)p->menu();return 0;
            case WM_DISPLAYCHANGE:p->place();p->events|=4;return 0;
            case WM_DPICHANGED:p->place();p->events|=4;return 0;
            case WM_CLOSE:p->state.visible=0;p->place();return 0;
        }return DefWindowProcW(hwnd,msg,w,l);
    }
    void init(const char* file){
        HRESULT com=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);comStarted=SUCCEEDED(com);if(FAILED(com)&&com!=RPC_E_CHANGED_MODE)check(com,"CoInitializeEx");
        WNDCLASSW wc{};wc.lpfnWndProc=proc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"PekoPet.Native";wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);RegisterClassW(&wc);
        hwnd=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|WS_EX_NOREDIRECTIONBITMAP,wc.lpszClassName,L"PekoPet 桌宠",WS_POPUP,state.x,state.y,state.width,state.height,nullptr,nullptr,wc.hInstance,this);if(!hwnd)throw std::runtime_error("CreateWindow failed");
        D3D_FEATURE_LEVEL level;check(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&device,&level,&context),"D3D11CreateDevice");
        ComPtr<IDXGIDevice> dxgi;device.As(&dxgi);ComPtr<IDXGIAdapter> adapter;check(dxgi->GetAdapter(&adapter),"GetAdapter");ComPtr<IDXGIFactory2> factory;check(adapter->GetParent(IID_PPV_ARGS(&factory)),"GetFactory");
        DXGI_SWAP_CHAIN_DESC1 desc{};desc.Width=state.width;desc.Height=state.height;desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;desc.BufferCount=2;desc.SwapEffect=DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;desc.AlphaMode=DXGI_ALPHA_MODE_PREMULTIPLIED;
        check(factory->CreateSwapChainForComposition(device.Get(),&desc,nullptr,&swap),"CreateSwapChainForComposition");
        ComPtr<ID3D11Texture2D> buffer;check(swap->GetBuffer(0,IID_PPV_ARGS(&buffer)),"GetBuffer");check(device->CreateRenderTargetView(buffer.Get(),nullptr,&target),"CreateRenderTargetView");
        check(DCompositionCreateDevice(dxgi.Get(),IID_PPV_ARGS(&composition)),"DCompositionCreateDevice");check(composition->CreateTargetForHwnd(hwnd,TRUE,&compTarget),"CreateTargetForHwnd");check(composition->CreateVisual(&visual),"CreateVisual");check(visual->SetContent(swap.Get()),"SetContent");check(compTarget->SetRoot(visual.Get()),"SetRoot");check(composition->Commit(),"Commit");
        option.LoggingLevel=CubismFramework::Option::LogLevel_Off;option.LoadFileFunction=loadShader;option.ReleaseBytesFunction=releaseShader;
        if(!CubismFramework::StartUp(&allocator,&option))throw std::runtime_error("Cubism startup failed");CubismFramework::Initialize();frameworkStarted=true;
        CubismRenderer_D3D11::SetConstantSettings(2,device.Get());model=std::make_unique<Model>();model->load(path(file));model->CreateRenderer(state.width,state.height);
        textures.resize(model->setting->GetTextureCount());
        tray.cbSize=sizeof(tray);tray.hWnd=hwnd;tray.uID=1;tray.uFlags=NIF_MESSAGE|NIF_ICON|NIF_TIP;tray.uCallbackMessage=WM_APP+1;tray.hIcon=LoadIconW(nullptr,IDI_APPLICATION);wcscpy_s(tray.szTip,L"PekoPet · Ctrl+Alt+P");Shell_NotifyIconW(NIM_ADD,&tray);
        RegisterHotKey(hwnd,1,MOD_CONTROL|MOD_ALT|MOD_NOREPEAT,'P');RegisterHotKey(hwnd,2,MOD_CONTROL|MOD_ALT|MOD_SHIFT|MOD_NOREPEAT,'P');place();events|=4;
    }
    void draw(float dt){
        if(!state.visible)return;
        POINT cursor;GetCursorPos(&cursor);float gx=std::clamp((cursor.x-state.x-state.width*.5f)/600.f,-1.f,1.f),gy=std::clamp((state.y+state.height*.4f-cursor.y)/600.f,-1.f,1.f);
        model->update(std::min(dt,0.1f),gx,gy);
        const float clear[4]={0,0,0,0};context->ClearRenderTargetView(target.Get(),clear);auto rtv=target.Get();context->OMSetRenderTargets(1,&rtv,nullptr);
        D3D11_VIEWPORT vp{0,0,(float)state.width,(float)state.height,0,1};context->RSSetViewports(1,&vp);
        auto renderer=model->GetRenderer<CubismRenderer_D3D11>();renderer->StartFrame(context.Get());
        model->GetModelMatrix()->SetHeight(1.85f*state.scale);model->GetModelMatrix()->SetCenterPosition(0,0);
        CubismMatrix44 projection;projection.Scale((float)state.height/state.width,1);projection.MultiplyByMatrix(model->GetModelMatrix());renderer->SetMvpMatrix(&projection);renderer->IsPremultipliedAlpha(false);renderer->DrawModel();renderer->EndFrame();check(swap->Present(1,0),"Present");
    }
    ~Pet(){
        Shell_NotifyIconW(NIM_DELETE,&tray);
        if(hwnd){UnregisterHotKey(hwnd,1);UnregisterHotKey(hwnd,2);}
        model.reset();
        if(frameworkStarted){CubismRenderer::StaticRelease();CubismFramework::Dispose();CubismFramework::CleanUp();}
        visual.Reset();compTarget.Reset();composition.Reset();target.Reset();swap.Reset();textures.clear();context.Reset();device.Reset();
        if(hwnd)DestroyWindow(hwnd);
        if(comStarted)CoUninitialize();
    }
};

extern "C" {
const char* peko_error(){return last_error.c_str();}
void* peko_create(const char* file,PekoRect state){try{auto p=std::make_unique<Pet>();p->state=state;p->init(file);return p.release();}catch(const std::exception& e){last_error=e.what();return nullptr;}}
void peko_destroy(void* p){delete(Pet*)p;}
int peko_texture_count(void* p){return ((Pet*)p)->model->setting->GetTextureCount();}
const char* peko_texture_name(void* p,int i){return ((Pet*)p)->model->setting->GetTextureFileName(i);}
int peko_texture(void* raw,int i,const uint8_t* rgba,int w,int h){try{auto p=(Pet*)raw;D3D11_TEXTURE2D_DESC d{};d.Width=w;d.Height=h;d.MipLevels=1;d.ArraySize=1;d.Format=DXGI_FORMAT_R8G8B8A8_UNORM;d.SampleDesc.Count=1;d.Usage=D3D11_USAGE_IMMUTABLE;d.BindFlags=D3D11_BIND_SHADER_RESOURCE;D3D11_SUBRESOURCE_DATA data{rgba,(UINT)w*4,0};ComPtr<ID3D11Texture2D> t;check(p->device->CreateTexture2D(&d,&data,&t),"CreateTexture2D");check(p->device->CreateShaderResourceView(t.Get(),nullptr,&p->textures.at(i)),"CreateShaderResourceView");p->model->GetRenderer<CubismRenderer_D3D11>()->BindTexture(i,p->textures.at(i).Get());return 1;}catch(const std::exception& e){last_error=e.what();return 0;}}
int peko_parameter_count(void* p){return ((Pet*)p)->model->GetModel()->GetParameterCount();}
const char* peko_parameter_id(void* p,int i){return ((Pet*)p)->model->GetModel()->GetParameterId(i)->GetString().GetRawString();}
void peko_parameter_info(void* p,int i,float* lo,float* hi,float* initial){auto m=((Pet*)p)->model->GetModel();*lo=m->GetParameterMinimumValue(i);*hi=m->GetParameterMaximumValue(i);*initial=m->GetParameterDefaultValue(i);}
void peko_reset_targets(void* p){auto m=((Pet*)p)->model.get();for(auto& [k,e]:m->expressions)e.target=0;for(auto& [k,e]:m->parameters)e.target=0;}
void peko_cancel_motion(void* p){((Pet*)p)->model->cancel();}
int peko_expression(void* p,const char* file,float weight){try{auto m=((Pet*)p)->model.get();auto it=m->expressions.find(file);if(it==m->expressions.end()){auto b=bytes(path(file));auto motion=CubismExpressionMotion::Create(b.data(),(csmSizeInt)b.size());if(!motion)throw std::runtime_error("Expression load failed");it=m->expressions.emplace(file,Model::Expr{motion}).first;}it->second.target=weight;return 1;}catch(const std::exception& e){last_error=e.what();return 0;}}
void peko_parameter(void* p,const char* id,float value){auto& e=((Pet*)p)->model->parameters[id];e.value=value;e.target=1;}
int peko_motion(void* p,const char* file){try{((Pet*)p)->model->motion(path(file));return 1;}catch(const std::exception& e){last_error=e.what();return 0;}}
int peko_tick(void* raw,float dt){auto p=(Pet*)raw;MSG msg;while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}try{p->draw(dt);}catch(const std::exception& e){last_error=e.what();return -1;}int e=p->events;p->events=0;return e;}
PekoRect peko_window_state(void* p){return ((Pet*)p)->state;}
const char* peko_monitor(void* p){return ((Pet*)p)->monitorName;}
int peko_dpi(void* p){return ((Pet*)p)->dpi;}
void peko_configure(void* p,PekoRect s){((Pet*)p)->state=s;((Pet*)p)->place();}
void peko_show_chat(intptr_t hwnd,int show){if(show){ShowWindow((HWND)hwnd,SW_RESTORE);SetForegroundWindow((HWND)hwnd);}else ShowWindow((HWND)hwnd,SW_HIDE);}
void peko_show_chat_quiet(intptr_t hwnd){ShowWindow((HWND)hwnd,SW_SHOWNOACTIVATE);}
void peko_notify(void* raw,const char* message){auto p=(Pet*)raw;auto info=p->tray;info.uFlags=NIF_INFO;info.dwInfoFlags=NIIF_INFO|NIIF_NOSOUND;wcscpy_s(info.szInfoTitle,L"PekoPet");MultiByteToWideChar(CP_UTF8,0,message,-1,info.szInfo,(int)std::size(info.szInfo));Shell_NotifyIconW(NIM_MODIFY,&info);}
}

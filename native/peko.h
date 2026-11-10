#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct PekoRect { int x,y,width,height; float scale; int topmost,through,visible,positioned; } PekoRect;
void* peko_create(const char* model_json, PekoRect state);
void peko_destroy(void* pet);
const char* peko_error(void);
int peko_texture_count(void* pet);
const char* peko_texture_name(void* pet, int index);
int peko_texture(void* pet,int index,const uint8_t* rgba,int width,int height);
int peko_parameter_count(void* pet);
const char* peko_parameter_id(void* pet,int index);
void peko_parameter_info(void* pet,int index,float* min,float* max,float* initial);
void peko_reset_targets(void* pet);
void peko_cancel_motion(void* pet);
int peko_expression(void* pet,const char* file,float weight);
void peko_parameter(void* pet,const char* id,float value);
int peko_motion(void* pet,const char* file);
int peko_tick(void* pet,float delta_seconds);
PekoRect peko_window_state(void* pet);
const char* peko_monitor(void* pet);
int peko_dpi(void* pet);
void peko_configure(void* pet,PekoRect state);
void peko_show_chat(intptr_t hwnd,int show);
void peko_show_chat_quiet(intptr_t hwnd);
void peko_notify(void* pet,const char* message);
int peko_reduced_motion(void);
#ifdef __cplusplus
}
#endif

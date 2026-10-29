#include <jni.h>
#include <android/bitmap.h>
#include <webp/mux.h>
#include <webp/encode.h>
#include <vector>
#include <cstdint>
#include <algorithm>
#include "tgs-scene.h"

struct Session { WebPAnimEncoder* encoder; WebPConfig config; std::vector<uint8_t> rgba; };
extern "C" JNIEXPORT jlong JNICALL Java_com_xtreme_stickers_Converter_begin(JNIEnv*, jclass, jint quality) {
    WebPAnimEncoderOptions options;
    if (!WebPAnimEncoderOptionsInit(&options)) return 0;
    options.anim_params.loop_count = 0;
    Session* s = new Session{};
    if (!WebPConfigInit(&s->config)) { delete s; return 0; }
    s->config.quality = quality;
    s->config.method = 0;
    s->config.thread_level = 1;
    s->rgba.resize(512 * 512 * 4);
    s->encoder = WebPAnimEncoderNew(512, 512, &options);
    if (!s->encoder) { delete s; return 0; }
    return reinterpret_cast<jlong>(s);
}
extern "C" JNIEXPORT jboolean JNICALL Java_com_xtreme_stickers_Converter_frame(JNIEnv* env, jclass, jlong handle, jobject bitmap, jint time) {
    auto* s = reinterpret_cast<Session*>(handle);
    AndroidBitmapInfo info;
    if (!s || AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS || info.width != 512 || info.height != 512 || info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) return false;
    void* pixels = nullptr;
    if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) return false;
    auto& rgba=s->rgba;
    for (int y = 0; y < 512; ++y) for (int x = 0; x < 512; ++x) {
        auto* p = static_cast<uint8_t*>(pixels) + y * info.stride + x * 4;
        auto* d = rgba.data() + (y * 512 + x) * 4;
        d[3] = p[3];
        for (int c = 0; c < 3; ++c) d[c] = p[3]==255?p[c]:p[3] ? static_cast<uint8_t>(std::min(255, (p[c] * 255 + p[3] / 2) / p[3])) : 0;
    }
    AndroidBitmap_unlockPixels(env, bitmap);
    WebPPicture pic;
    if (!WebPPictureInit(&pic)) return false;
    pic.width = pic.height = 512;
    pic.use_argb = 1;
    bool ok = WebPPictureImportRGBA(&pic, rgba.data(), 512 * 4) && WebPAnimEncoderAdd(s->encoder, &pic, time, &s->config);
    WebPPictureFree(&pic);
    return ok;
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_com_xtreme_stickers_Converter_finish(JNIEnv* env, jclass, jlong handle, jint time) {
    auto* s = reinterpret_cast<Session*>(handle);
    if (!s) return nullptr;
    WebPData data;
    WebPDataInit(&data);
    jbyteArray result = nullptr;
    if (WebPAnimEncoderAdd(s->encoder, nullptr, time, nullptr) && WebPAnimEncoderAssemble(s->encoder, &data) && data.size <= 512000) {
        result = env->NewByteArray(static_cast<jsize>(data.size));
        if (result) env->SetByteArrayRegion(result, 0, static_cast<jsize>(data.size), reinterpret_cast<const jbyte*>(data.bytes));
    }
    WebPDataClear(&data);
    WebPAnimEncoderDelete(s->encoder);
    delete s;
    return result;
}
extern "C" JNIEXPORT void JNICALL Java_com_xtreme_stickers_Converter_abort(JNIEnv*, jclass, jlong handle) {
    auto* s = reinterpret_cast<Session*>(handle);
    if (s) { WebPAnimEncoderDelete(s->encoder); delete s; }
}
extern "C" JNIEXPORT jlong JNICALL Java_com_xtreme_stickers_Converter_openTgs(JNIEnv* env,jclass,jbyteArray json){
    jsize size=env->GetArrayLength(json);if(size<=0||size>2*1024*1024)return 0;
    std::string text(size,'\0');env->GetByteArrayRegion(json,0,size,reinterpret_cast<jbyte*>(&text[0]));
    if(env->ExceptionCheck())return 0;
    try{return reinterpret_cast<jlong>(TgsScene::open(text).release());}catch(...){return 0;}
}
extern "C" JNIEXPORT jint JNICALL Java_com_xtreme_stickers_Converter_tgsDuration(JNIEnv*,jclass,jlong handle){return reinterpret_cast<TgsScene*>(handle)->durationMs;}
extern "C" JNIEXPORT jboolean JNICALL Java_com_xtreme_stickers_Converter_tgsFrame(JNIEnv*,jclass,jlong sceneHandle,jlong encoderHandle,jint ms){
    auto* scene=reinterpret_cast<TgsScene*>(sceneHandle);auto* s=reinterpret_cast<Session*>(encoderHandle);
    if(!scene||!s||!scene->render(ms))return false;
    WebPPicture pic;if(!WebPPictureInit(&pic))return false;
    pic.width=pic.height=512;pic.use_argb=1;
    bool ok=WebPPictureImportRGBA(&pic,reinterpret_cast<uint8_t*>(scene->pixels.data()),512*4)&&WebPAnimEncoderAdd(s->encoder,&pic,ms,&s->config);
    WebPPictureFree(&pic);return ok;
}
extern "C" JNIEXPORT void JNICALL Java_com_xtreme_stickers_Converter_closeTgs(JNIEnv*,jclass,jlong handle){delete reinterpret_cast<TgsScene*>(handle);}

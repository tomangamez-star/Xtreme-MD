#pragma once
#include <thorvg.h>
#include <vector>
#include <cmath>
#include <mutex>
#include <algorithm>

// Canvas releases its owned picture before the animation controller is freed.
struct TgsScene {
    std::vector<uint32_t> pixels;
    std::unique_ptr<tvg::Animation> animation;
    std::unique_ptr<tvg::SwCanvas> canvas;
    int durationMs=0;
    static std::unique_ptr<TgsScene> open(const std::string& json) {
        static std::once_flag once;static bool initialized=false;
        std::call_once(once,[]{initialized=tvg::Initializer::init(tvg::CanvasEngine::Sw,2)==tvg::Result::Success;});
        if(!initialized)return nullptr;
        auto s=std::unique_ptr<TgsScene>(new TgsScene{});
        s->animation=tvg::Animation::gen();s->canvas=tvg::SwCanvas::gen();
        if(!s->animation||!s->canvas)return nullptr;
        auto picture=s->animation->picture();
        if(picture->load(json.data(),json.size(),"lottie",true)!=tvg::Result::Success)return nullptr;
        float seconds=s->animation->duration();
        if(!std::isfinite(seconds)||seconds<=0||seconds>600)return nullptr;
        s->durationMs=static_cast<int>(seconds*1000);
        float w=0,h=0;
        if(picture->size(&w,&h)!=tvg::Result::Success||w<=0||h<=0||w>4096||h>4096)return nullptr;
        float scale=std::min(512.f/w,512.f/h);
        picture->scale(scale);picture->translate((512-w*scale)/2,(512-h*scale)/2);
        s->pixels.resize(512*512);
        if(s->canvas->target(s->pixels.data(),512,512,512,tvg::SwCanvas::ABGR8888S)!=tvg::Result::Success)return nullptr;
        if(s->canvas->push(tvg::cast(picture))!=tvg::Result::Success)return nullptr;
        return s;
    }
    bool render(int ms){
        float f=std::min(animation->totalFrame()-1,ms*animation->totalFrame()/std::max(1,durationMs));
        animation->frame(f);
        if(canvas->update()!=tvg::Result::Success)return false;
        return canvas->draw()==tvg::Result::Success&&canvas->sync()==tvg::Result::Success;
    }
};

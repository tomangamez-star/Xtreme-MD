#include "tgs-scene.h"
#include <webp/mux.h>
#include <webp/encode.h>
#include <webp/demux.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>

void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
std::vector<uint8_t> encode(TgsScene& scene,int method,int fps,int quality){
    WebPAnimEncoderOptions options;require(WebPAnimEncoderOptionsInit(&options),"options");
    auto* encoder=WebPAnimEncoderNew(512,512,&options);require(encoder,"encoder");
    WebPConfig config;require(WebPConfigInit(&config),"config");config.method=method;config.quality=quality;config.thread_level=1;
    try{
        for(int index=0,ms=0;ms<scene.durationMs;ms=(++index)*1000/fps){
            require(scene.render(ms),"render");WebPPicture pic;require(WebPPictureInit(&pic),"picture");pic.width=pic.height=512;pic.use_argb=1;
            bool ok=WebPPictureImportRGBA(&pic,reinterpret_cast<uint8_t*>(scene.pixels.data()),512*4)&&WebPAnimEncoderAdd(encoder,&pic,ms,&config);
            WebPPictureFree(&pic);require(ok,"add frame");
        }
        require(WebPAnimEncoderAdd(encoder,nullptr,scene.durationMs,nullptr),"finish");
        WebPData data;WebPDataInit(&data);require(WebPAnimEncoderAssemble(encoder,&data),"assemble");
        std::vector<uint8_t> result(data.bytes,data.bytes+data.size);WebPDataClear(&data);WebPAnimEncoderDelete(encoder);return result;
    }catch(...){WebPAnimEncoderDelete(encoder);throw;}
}
int main(int argc,char** argv){
    try{
        require(argc==2,"fixture argument required");std::ifstream input(argv[1]);require(input.good(),"fixture missing");
        std::string json((std::istreambuf_iterator<char>(input)),{});auto scene=TgsScene::open(json);require(bool(scene),"load native Lottie");
        require(!TgsScene::open("{broken"),"invalid JSON accepted");
        require(scene->durationMs==1000,"duration");require(scene->render(0),"first render");auto first=scene->pixels;
        require(scene->render(800),"last render");require(first!=scene->pixels,"animation does not move");
        require(first[0]==0,"transparent padding lost");
        // Native target is straight-alpha RGBA bytes; red must not become blue.
        bool red=false;for(uint32_t pixel:first)if((pixel&255)>200&&((pixel>>16)&255)<10&&(pixel>>24)>200)red=true;
        require(red,"RGBA channel order");
        for(int method:{4,0}){
            auto start=std::chrono::steady_clock::now();auto bytes=encode(*scene,method,15,60);
            auto ms=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-start).count();
            require(bytes.size()<=512000,"size limit");WebPData data{bytes.data(),bytes.size()};auto* decoder=WebPAnimDecoderNew(&data,nullptr);require(decoder,"decode output");
            WebPAnimInfo info;require(WebPAnimDecoderGetInfo(decoder,&info),"output info");require(info.canvas_width==512&&info.canvas_height==512&&info.frame_count>1,"animated dimensions");
            uint8_t* pixels=nullptr;int timestamp=0;while(WebPAnimDecoderHasMoreFrames(decoder))require(WebPAnimDecoderGetNext(decoder,&pixels,&timestamp),"decode frame");
            require(timestamp==1000,"animation duration changed");WebPAnimDecoderDelete(decoder);
            std::cout<<"method="<<method<<" fps=15 quality=60 ms="<<ms<<" bytes="<<bytes.size()<<" frames="<<info.frame_count<<std::endl;
        }
        std::cout<<"PASS: native rendering, motion, transparency, RGBA order, encoding and limits"<<std::endl;return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}

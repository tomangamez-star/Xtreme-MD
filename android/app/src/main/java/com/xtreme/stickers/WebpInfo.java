package com.xtreme.stickers;
import java.io.IOException;

final class WebpInfo {
    int width,height,frames,duration;
    boolean animated;
    private static long le(byte[] b,int p,int count){long n=0;for(int i=0;i<count;i++)n|=(b[p+i]&255L)<<(i*8);return n;}
    static WebpInfo read(byte[] b)throws IOException{
        if(b.length<12||!tag(b,0,"RIFF")||!tag(b,8,"WEBP")||le(b,4,4)+8!=b.length)throw new IOException("Invalid WebP container");
        WebpInfo info=new WebpInfo();
        for(int p=12;p+8<=b.length;){
            long size=le(b,p+4,4),next=p+8+size+(size&1);
            if(next>b.length)throw new IOException("Truncated WebP");
            if(tag(b,p,"VP8X")&&size>=10){info.width=(int)le(b,p+12,3)+1;info.height=(int)le(b,p+15,3)+1;}
            if(tag(b,p,"ANIM"))info.animated=true;
            if(tag(b,p,"ANMF")){
                if(size<16)throw new IOException("Invalid animation frame");
                int delay=(int)le(b,p+20,3);if(delay<8)throw new IOException("Animation frame delay is too short");
                info.frames++;info.duration+=delay;
            }
            p=(int)next;
        }
        return info;
    }
    private static boolean tag(byte[] b,int p,String tag){if(p+4>b.length)return false;for(int i=0;i<4;i++)if(b[p+i]!=(byte)tag.charAt(i))return false;return true;}
    static void requireAnimation(byte[] bytes)throws IOException{
        WebpInfo i=read(bytes);
        if(bytes.length>512000||!i.animated||i.frames<2||i.width!=512||i.height!=512||i.duration<=0||i.duration>10000)
            throw new IOException("Animated source produced invalid or single-frame output. It was not changed to a static sticker.");
    }
}

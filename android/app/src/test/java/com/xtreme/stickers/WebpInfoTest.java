package com.xtreme.stickers;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
public class WebpInfoTest {
    private static byte[] fixture(int count,int delay)throws Exception{
        ByteArrayOutputStream body=new ByteArrayOutputStream();body.write("WEBP".getBytes("US-ASCII"));
        body.write("VP8X".getBytes("US-ASCII"));body.write(new byte[]{10,0,0,0,2,0,0,0,(byte)255,1,0,(byte)255,1,0});
        body.write("ANIM".getBytes("US-ASCII"));body.write(new byte[]{6,0,0,0,0,0,0,0,0,0});
        for(int i=0;i<count;i++){body.write("ANMF".getBytes("US-ASCII"));body.write(new byte[]{16,0,0,0});byte[] frame=new byte[16];frame[12]=(byte)delay;frame[13]=(byte)(delay>>8);body.write(frame);}
        byte[] payload=body.toByteArray();ByteArrayOutputStream file=new ByteArrayOutputStream();file.write("RIFF".getBytes("US-ASCII"));for(int i=0;i<4;i++)file.write(payload.length>>(i*8));file.write(payload);return file.toByteArray();
    }
    @Test public void realFrameCountRequired()throws Exception{
        WebpInfo.requireAnimation(fixture(2,67));
        try{WebpInfo.requireAnimation(fixture(1,100));fail("single-frame accepted");}catch(IOException expected){}
    }
    @Test public void durationAndTruncationRejected()throws Exception{
        for(byte[] bad:new byte[][]{fixture(2,6000),new byte[12]})try{WebpInfo.requireAnimation(bad);fail("invalid data accepted");}catch(IOException expected){}
    }
}

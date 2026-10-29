package com.xtreme.stickers;
import java.nio.file.*;
public class WebpPacketProbe {
    public static void main(String[] args)throws Exception{
        for(String path:args)WebpInfo.requireAnimation(Files.readAllBytes(Path.of(path)));
        System.out.println("PASS: Android Java validator accepted "+args.length+" animated WebP files");
    }
}

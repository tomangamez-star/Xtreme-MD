package com.xtreme.stickers;

import android.graphics.*;
import android.media.MediaMetadataRetriever;
import com.airbnb.lottie.*;
import java.io.*;
import java.util.zip.GZIPInputStream;

final class Converter {
    static { System.loadLibrary("xtremewebp"); }
    private static native long begin(int quality);
    private static native boolean frame(long handle, Bitmap bitmap, int time);
    private static native byte[] finish(long handle, int time);
    private static native void abort(long handle);
    static boolean isAnimatedWebp(byte[] bytes) {
        for (int offset=12; offset+8<=bytes.length;) {
            if(bytes[offset]=='A'&&bytes[offset+1]=='N'&&bytes[offset+2]=='I'&&bytes[offset+3]=='M')return true;
            long size=(bytes[offset+4]&255L)|((bytes[offset+5]&255L)<<8)|((bytes[offset+6]&255L)<<16)|((bytes[offset+7]&255L)<<24);
            long next=offset+8L+size+(size&1);
            if(next>bytes.length)return false;
            offset=(int)next;
        }
        return false;
    }
    interface Frames extends AutoCloseable { int duration(); void draw(Canvas canvas, int ms) throws Exception; default void close() throws Exception {} }
    static Bitmap fit(Bitmap source, int size) {
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        float scale = Math.min((float)size / source.getWidth(), (float)size / source.getHeight());
        float w = source.getWidth() * scale, h = source.getHeight() * scale;
        new Canvas(out).drawBitmap(source, null, new RectF((size-w)/2, (size-h)/2, (size+w)/2, (size+h)/2), new Paint(3));
        return out;
    }
    static byte[] staticImage(File input) throws Exception {
        Bitmap source = ImageDecoder.decodeBitmap(ImageDecoder.createSource(input), (decoder,info,s) -> {
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            decoder.setTargetSampleSize(Math.max(1,Math.max(info.getSize().getWidth(),info.getSize().getHeight())/1024));
        });
        if (source == null) throw new IOException("Cannot decode this image");
        Bitmap scaled = fit(source, 512); source.recycle();
        try {
            for (int quality : new int[]{90, 70, 50, 30, 15}) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.WEBP, quality, out);
                if (out.size() <= 100 * 1024) return out.toByteArray();
            }
            throw new IOException("Image exceeds WhatsApp’s size limit");
        } finally { scaled.recycle(); }
    }
    static byte[] animation(File input, String format) throws Exception {
        try (Frames frames = source(input, format)) {
            int duration = Math.min(10000, Math.max(200, frames.duration()));
            for (int[] preset : new int[][]{{20,75},{15,55},{10,35},{8,20}}) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                long handle = begin(preset[1]);
                if (handle == 0) throw new IOException("Encoder unavailable");
                Bitmap bitmap = Bitmap.createBitmap(512,512,Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                try {
                    for (int time = 0; time < duration; time += 1000 / preset[0]) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                        bitmap.eraseColor(Color.TRANSPARENT); frames.draw(canvas, time);
                        if (!frame(handle, bitmap, time)) throw new IOException("Animation encoding failed");
                    }
                    long owned = handle; handle = 0;
                    byte[] bytes = finish(owned, duration);
                    if (bytes != null) return bytes;
                } finally { bitmap.recycle(); if (handle != 0) abort(handle); }
            }
            throw new IOException("Animation cannot fit 500 KB; choose a simpler or shorter clip");
        }
    }
    private static Frames source(File file, String format) throws Exception {
        if (format.equals("tgs")) {
            byte[] json;
            try (InputStream in = new GZIPInputStream(new FileInputStream(file))) { json = Net.read(in, 2 * 1024 * 1024); }
            LottieResult<LottieComposition> result = LottieCompositionFactory.fromJsonStringSync(new String(json, java.nio.charset.StandardCharsets.UTF_8), null);
            LottieComposition composition = result.getValue();
            if (composition == null || !composition.getImages().isEmpty()) throw new IOException("Unsupported TGS animation");
            LottieDrawable drawable = new LottieDrawable(); drawable.setComposition(composition);
            drawable.setBounds(0,0,512,512);
            return new Frames() {
                public int duration() { return (int)composition.getDuration(); }
                public void draw(Canvas c, int ms) { drawable.setProgress(ms / Math.max(1f, composition.getDuration())); drawable.draw(c); }
            };
        }
        if (format.equals("gif")) {
            android.graphics.Movie movie = android.graphics.Movie.decodeFile(file.getPath());
            if (movie == null || movie.width() > 4096 || movie.height() > 4096) throw new IOException("Unsupported GIF");
            return new Frames() {
                public int duration() { return movie.duration() > 0 ? movie.duration() : 1000; }
                public void draw(Canvas c, int ms) {
                    movie.setTime(ms); float scale = Math.min(512f/movie.width(),512f/movie.height());
                    c.save(); c.translate((512-movie.width()*scale)/2,(512-movie.height()*scale)/2); c.scale(scale,scale); movie.draw(c,0,0); c.restore();
                }
            };
        }
        MediaMetadataRetriever video = new MediaMetadataRetriever();
        try {
            video.setDataSource(file.getPath());
            int duration = Integer.parseInt(video.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            return new Frames() {
                public int duration() { return duration; }
                public void draw(Canvas c, int ms) throws Exception {
                    Bitmap raw = video.getScaledFrameAtTime(ms * 1000L, MediaMetadataRetriever.OPTION_CLOSEST, 512,512);
                    if (raw == null) throw new IOException("This phone cannot decode this video format");
                    Bitmap scaled = fit(raw,512); c.drawBitmap(scaled,0,0,null); scaled.recycle(); raw.recycle();
                }
                public void close() throws Exception { video.release(); }
            };
        } catch (Exception e) { video.release(); throw e; }
    }
}

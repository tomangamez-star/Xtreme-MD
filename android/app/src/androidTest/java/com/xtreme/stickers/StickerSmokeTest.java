package com.xtreme.stickers;

import android.content.Context;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.GZIPOutputStream;

@RunWith(AndroidJUnit4.class)
public class StickerSmokeTest {
    @Test public void staticPackAndProviderRoundTrip() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File temp=Files.createTempDirectory(c.getCacheDir().toPath(),"smoke-").toFile();
        List<String> ids=new ArrayList<>();
        try {
            Bitmap image=Bitmap.createBitmap(240,120,Bitmap.Config.ARGB_8888);image.eraseColor(0x80FF3366);
            File input=new File(temp,"input.png");try(OutputStream out=new FileOutputStream(input)){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();
            byte[] bytes=Converter.staticImage(input);assertTrue(bytes.length<=102400);assertFalse(Converter.isAnimatedWebp(bytes));
            Bitmap decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length);assertEquals(512,decoded.getWidth());assertEquals(512,decoded.getHeight());assertEquals(0,Color.alpha(decoded.getPixel(0,0)));decoded.recycle();
            File sticker=new File(temp,"sticker.webp");Files.write(sticker.toPath(),bytes);
            ids=PackStore.save(c,Arrays.asList(sticker,sticker,sticker),false,"Smoke test","Xtreme");assertEquals(1,ids.size());
            String base="content://"+c.getPackageName()+".provider/";
            try(Cursor cursor=c.getContentResolver().query(Uri.parse(base+"metadata/"+ids.get(0)),null,null,null,null)){
                assertNotNull(cursor);assertTrue(cursor.moveToFirst());assertEquals("Smoke test",cursor.getString(cursor.getColumnIndexOrThrow("sticker_pack_name")));assertEquals(0,cursor.getInt(cursor.getColumnIndexOrThrow("animated_sticker_pack")));
            }
            try(Cursor cursor=c.getContentResolver().query(Uri.parse(base+"stickers/"+ids.get(0)),null,null,null,null)){assertNotNull(cursor);assertEquals(3,cursor.getCount());}
            try(InputStream in=c.getContentResolver().openInputStream(Uri.parse(base+"stickers_asset/"+ids.get(0)+"/0.webp"))){assertArrayEquals(bytes,Net.read(in,102400));}
            try{c.getContentResolver().openInputStream(Uri.parse(base+"stickers_asset/"+ids.get(0)+"/pack.json"));fail("metadata file exposed");}catch(FileNotFoundException expected){}
        } finally {for(String id:ids)PackStore.removeTree(PackStore.dir(c,id));PackStore.removeTree(temp);}
    }
    @Test public void tgsConvertsToRealAnimatedWebp() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File input=File.createTempFile("smoke-",".tgs",c.getCacheDir());
        String json="""
            {"v":"5.5.2","fr":20,"ip":0,"op":20,"w":512,"h":512,"nm":"Square","ddd":0,"assets":[],"layers":[{"ddd":0,"ind":1,"ty":1,"nm":"Square","sw":80,"sh":80,"sc":"#ff0000","ip":0,"op":20,"st":0,"ks":{"o":{"a":0,"k":100},"r":{"a":0,"k":0},"p":{"a":1,"k":[{"t":0,"s":[100,100,0],"e":[350,350,0],"o":{"x":0.33,"y":0.33},"i":{"x":0.67,"y":0.67}},{"t":20,"s":[350,350,0]}]},"a":{"a":0,"k":[0,0,0]},"s":{"a":0,"k":[100,100,100]}}}]}
            """;
        try {
            try(OutputStream out=new GZIPOutputStream(new FileOutputStream(input))){out.write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            byte[] bytes=Converter.animation(input,"tgs");assertTrue(bytes.length<=512000);assertTrue(Converter.isAnimatedWebp(bytes));
            Bitmap image=BitmapFactory.decodeByteArray(bytes,0,bytes.length);assertEquals(512,image.getWidth());assertEquals(512,image.getHeight());image.recycle();
        }finally{input.delete();}
    }
}

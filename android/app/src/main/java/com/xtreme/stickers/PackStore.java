package com.xtreme.stickers;

import android.content.Context;
import android.graphics.*;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

final class PackStore {
    static File root(Context c) { File f = new File(c.getFilesDir(), "packs"); f.mkdirs(); return f; }
    static File dir(Context c, String id) {
        if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid pack identifier");
        return new File(root(c), id);
    }
    static synchronized JSONObject get(Context c, String id) throws Exception {
        return new JSONObject(new String(new AtomicFile(new File(dir(c,id), "pack.json")).readFully(), StandardCharsets.UTF_8));
    }
    static synchronized List<JSONObject> all(Context c) {
        List<JSONObject> packs = new ArrayList<>(); File[] files = root(c).listFiles();
        if (files != null) for (File file : files) {
            if (file.getName().startsWith(".")) continue;
            try { packs.add(get(c, file.getName())); } catch (Exception ignored) {}
        }
        packs.sort((a,b) -> Long.compare(b.optLong("created"),a.optLong("created")));
        return packs;
    }
    static synchronized void metadata(File dir, JSONObject json) throws Exception {
        AtomicFile target = new AtomicFile(new File(dir,"pack.json")); FileOutputStream out = null;
        try { out = target.startWrite(); out.write(json.toString().getBytes(StandardCharsets.UTF_8)); target.finishWrite(out); }
        catch (Exception e) { target.failWrite(out); throw e; }
    }
    static synchronized void rename(Context c, String id, String name, String author) throws Exception {
        validateLabels(name, author); JSONObject p = get(c,id); p.put("name",name.trim()); p.put("author",author.trim());
        p.put("version",String.valueOf(System.currentTimeMillis())); metadata(dir(c,id),p);
    }
    static void validateLabels(String name, String author) throws IOException {
        if (name.trim().isEmpty() || author.trim().isEmpty() || name.length()>64 || author.length()>64) throw new IOException("Pack name and author must each be 1–64 characters");
    }
    static int[] partitions(int count) {
        if (count < 3) return new int[0];
        int groups = (count+29)/30; int[] sizes = new int[groups];
        for (int i=0;i<groups;i++) sizes[i]=count/groups+(i<count%groups?1:0);
        return sizes;
    }
    // Input files are staged in cache; only complete, valid packs become visible.
    static List<String> save(Context c, List<File> stickers, boolean animated, String name, String author) throws Exception {
        validateLabels(name,author); int[] sizes = partitions(stickers.size());
        if (sizes.length==0) throw new IOException("Choose at least 3 " + (animated?"animated":"static") + " stickers");
        List<String> ids = new ArrayList<>(); int offset=0;
        try {
            for (int group=0;group<sizes.length;group++) {
                String id=UUID.randomUUID().toString(); File stage=new File(root(c),"."+id); stage.mkdirs();
                try {
                    JSONArray items=new JSONArray();
                    for (int i=0;i<sizes[group];i++) {
                        File source=stickers.get(offset++); String filename=i+".webp";
                        if (source.length()>(animated?500:100)*1024 || source.length()<12) throw new IOException("Invalid sticker size");
                        Files.copy(source.toPath(),new File(stage,filename).toPath()); items.put(filename);
                    }
                    Bitmap first=BitmapFactory.decodeFile(new File(stage,"0.webp").getPath());
                    if (first==null) throw new IOException("Cannot create pack icon");
                    Bitmap tray=Converter.fit(first,96); first.recycle();
                    try (OutputStream out=new FileOutputStream(new File(stage,"tray.png"))) { tray.compress(Bitmap.CompressFormat.PNG,100,out); } finally { tray.recycle(); }
                    if (new File(stage,"tray.png").length()>50*1024) throw new IOException("Tray icon is too large");
                    String suffix=sizes.length>1?" · "+(group+1):"";
                    String title=name.substring(0,Math.min(name.length(),64-suffix.length()))+suffix;
                    JSONObject pack=new JSONObject().put("id",id).put("name",title).put("author",author).put("animated",animated).put("stickers",items).put("created",System.currentTimeMillis()).put("version","1");
                    metadata(stage,pack);
                    if (!stage.renameTo(dir(c,id))) throw new IOException("Could not save pack");
                    ids.add(id);
                } finally { removeTree(stage); }
            }
            return ids;
        } catch (Exception e) { for(String id:ids) removeTree(dir(c,id)); throw e; }
    }
    static synchronized void tray(Context c,String id,int index) throws Exception {
        JSONObject p=get(c,id); String filename=p.getJSONArray("stickers").getString(index);
        Bitmap raw=BitmapFactory.decodeFile(new File(dir(c,id),filename).getPath());
        if(raw==null) throw new IOException("Cannot read sticker");
        Bitmap icon=Converter.fit(raw,96);raw.recycle();
        AtomicFile target=new AtomicFile(new File(dir(c,id),"tray.png")); FileOutputStream out=target.startWrite();
        try { icon.compress(Bitmap.CompressFormat.PNG,100,out);target.finishWrite(out); }
        catch(Exception e){target.failWrite(out);throw e;} finally{icon.recycle();}
        p.put("version",String.valueOf(System.currentTimeMillis()));metadata(dir(c,id),p);
    }
    static void removeTree(File f) { if (f.isDirectory()) { File[] files=f.listFiles(); if(files!=null)for(File child:files)removeTree(child); } f.delete(); }
}

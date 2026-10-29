package com.xtreme.stickers;
import android.content.Context;
import java.io.*;
import java.nio.file.*;
import java.util.*;

final class DraftStore {
    static final class State {
        File dir;
        final ArrayList<File> files=new ArrayList<>();
        final ArrayList<Boolean> animated=new ArrayList<>();
        final HashSet<Integer> selected=new HashSet<>();
        final ArrayList<Integer> indices=new ArrayList<>();
        String name="My Xtreme pack",author="Xtreme",notice="",jobId="",jobBase="";
    }
    private static File root(Context c){File f=new File(c.getFilesDir(),"drafts");f.mkdirs();return f;}
    static File create(Context c)throws IOException{return Files.createTempDirectory(root(c).toPath(),"draft-").toFile();}
    static void save(Context c,State s)throws IOException{write(s);}
    // Pure-Java journal: unit tested on the host, identical implementation in APK.
    // A crash during the temp write leaves the previous committed draft intact.
    static void write(State s)throws IOException{
        if(s.dir==null)return;
        Properties p=new Properties();p.setProperty("name",s.name);p.setProperty("author",s.author);
        p.setProperty("notice",s.notice);p.setProperty("job",s.jobId);p.setProperty("base",s.jobBase);
        p.setProperty("count",String.valueOf(s.files.size()));p.setProperty("indices",String.valueOf(s.indices.size()));
        for(int i=0;i<s.files.size();i++){p.setProperty("file."+i,s.files.get(i).getName());p.setProperty("animated."+i,String.valueOf(s.animated.get(i)));p.setProperty("selected."+i,String.valueOf(s.selected.contains(i)));}
        for(int i=0;i<s.indices.size();i++)p.setProperty("index."+i,String.valueOf(s.indices.get(i)));
        File temp=new File(s.dir,"draft.properties.tmp"),target=new File(s.dir,"draft.properties");
        try(FileOutputStream out=new FileOutputStream(temp)){p.store(out,"Xtreme recoverable draft");out.getFD().sync();}
        try{Files.move(temp.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
        catch(AtomicMoveNotSupportedException e){Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    }
    static State read(File dir)throws IOException{
        Properties p=new Properties();try(InputStream in=new FileInputStream(new File(dir,"draft.properties"))){p.load(in);}
        State s=new State();s.dir=dir;s.name=p.getProperty("name",s.name);s.author=p.getProperty("author",s.author);
        s.notice=p.getProperty("notice","");s.jobId=p.getProperty("job","");s.jobBase=p.getProperty("base","");
        int count=Integer.parseInt(p.getProperty("count","0")),indices=Integer.parseInt(p.getProperty("indices","0"));
        if(count<0||count>200||indices<0||indices>200)throw new IOException("Invalid draft count");
        for(int i=0;i<count;i++){
            String name=p.getProperty("file."+i,"");if(!name.matches("sticker-[0-9]+\\.webp"))continue;
            File f=new File(dir,name);if(!f.isFile())continue;
            s.files.add(f);s.animated.add(Boolean.parseBoolean(p.getProperty("animated."+i,"false")));
            if(Boolean.parseBoolean(p.getProperty("selected."+i,"true")))s.selected.add(s.files.size()-1);
        }
        for(int i=0;i<indices;i++){int n=Integer.parseInt(p.getProperty("index."+i));if(n<0||n>=200)throw new IOException("Invalid source index");s.indices.add(n);}
        return s;
    }
    static State recoverLegacy(File cache,File destination)throws Exception{
        File[] legacy=cache.listFiles(f->f.isDirectory()&&f.getName().startsWith("draft-"));
        if(legacy==null)return null;
        Arrays.sort(legacy,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
        for(File dir:legacy){
            File[] files=dir.listFiles(f->f.getName().matches("sticker-[0-9]+\\.webp"));if(files==null||files.length==0||files.length>200)continue;
            Arrays.sort(files,Comparator.comparingInt(f->Integer.parseInt(f.getName().replaceAll("[^0-9]",""))));
            State s=new State();s.dir=Files.createTempDirectory(destination.toPath(),"draft-").toFile();s.name="Recovered previous draft";
            s.notice="Recovered older converted files. Some may already be flattened; re-import the Telegram pack to restore motion.";
            for(File f:files){try{byte[] bytes=Files.readAllBytes(f.toPath());WebpInfo info=WebpInfo.read(bytes);File copy=new File(s.dir,f.getName());Files.write(copy.toPath(),bytes);s.files.add(copy);s.animated.add(info.animated&&info.frames>1);s.selected.add(s.files.size()-1);}catch(Exception ignored){}}
            if(!s.files.isEmpty()){write(s);return s;}
        }
        return null;
    }
    static State load(Context c)throws Exception{
        File[] dirs=root(c).listFiles();
        if(dirs!=null){Arrays.sort(dirs,(a,b)->Long.compare(b.lastModified(),a.lastModified()));for(File dir:dirs){
            if(!dir.getName().matches("draft-[a-zA-Z0-9-]+"))continue;
            try{State s=read(dir);if(!s.files.isEmpty()||!s.jobId.isEmpty())return s;}catch(Exception ignored){}
        }}
        if(c.getSharedPreferences("draft-recovery",0).getBoolean("legacyDone",false))return null;
        State s=recoverLegacy(c.getCacheDir(),root(c));
        c.getSharedPreferences("draft-recovery",0).edit().putBoolean("legacyDone",true).apply();return s;
    }
}

package com.xtreme.stickers;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
public class DraftStoreTest {
    @Test public void journalRestoresLabelsChoicesAndPendingJobAfterRestart()throws Exception{
        File dir=Files.createTempDirectory("draft-test-").toFile();
        try{
            DraftStore.State s=new DraftStore.State();s.dir=dir;s.name="Oshi no Ko ✭ 😍";s.author="MONTAI";s.jobId="pending-job";s.jobBase="https://example.com";s.indices.add(3);s.indices.add(49);
            for(int i=0;i<50;i++){File f=new File(dir,"sticker-"+i+".webp");Files.write(f.toPath(),new byte[]{1,2,3});s.files.add(f);s.animated.add(i==3);if(i!=2)s.selected.add(i);}
            DraftStore.write(s);DraftStore.State loaded=DraftStore.read(dir);
            assertEquals(s.name,loaded.name);assertEquals(s.author,loaded.author);assertEquals(50,loaded.files.size());assertEquals(s.animated,loaded.animated);assertEquals(s.selected,loaded.selected);assertEquals(s.indices,loaded.indices);assertEquals(s.jobId,loaded.jobId);
            // Simulate a crash before the next atomic replacement.
            Files.write(new File(dir,"draft.properties.tmp").toPath(),"broken partial write".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            assertEquals(50,DraftStore.read(dir).files.size());
        }finally{cleanup(dir);}
    }
    @Test public void savingEligibleGroupLeavesMinorityRecoverable()throws Exception{
        File dir=Files.createTempDirectory("draft-test-").toFile();
        try{
            DraftStore.State s=new DraftStore.State();s.dir=dir;File f=new File(dir,"sticker-3.webp");Files.write(f.toPath(),new byte[]{1});s.files.add(f);s.animated.add(true);s.selected.add(0);
            DraftStore.write(s);DraftStore.State recovered=DraftStore.read(dir);assertEquals(1,recovered.files.size());assertTrue(recovered.animated.get(0));assertTrue(recovered.files.get(0).exists());
        }finally{cleanup(dir);}
    }
    @Test public void journalCannotReadOutsideDraftDirectory()throws Exception{
        File dir=Files.createTempDirectory("draft-test-").toFile();
        try{
            Properties p=new Properties();p.setProperty("count","1");p.setProperty("file.0","../secret.webp");
            try(OutputStream out=new FileOutputStream(new File(dir,"draft.properties"))){p.store(out,"");}
            assertEquals(0,DraftStore.read(dir).files.size());
        }finally{cleanup(dir);}
    }
    private void cleanup(File dir)throws Exception{try(java.util.stream.Stream<Path> paths=Files.walk(dir.toPath())){paths.sorted(Comparator.reverseOrder()).forEach(p->{try{Files.delete(p);}catch(IOException ignored){}});}}
}

package com.xtreme.stickers;
import org.junit.Test;
import static org.junit.Assert.*;

public class PackStoreTest {
    @Test public void partitionsNeverLeaveUnusableRemainders(){
        for(int n=3;n<=200;n++){
            int total=0;
            for(int size:PackStore.partitions(n)){assertTrue(size>=3);assertTrue(size<=30);total+=size;}
            assertEquals(n,total);
        }
        assertArrayEquals(new int[]{16,15},PackStore.partitions(31));
        assertEquals(0,PackStore.partitions(2).length);
    }
    @Test public void labelsRejectEmptyOrLongValues()throws Exception{
        PackStore.validateLabels("Xtreme","You");
        for(String value:new String[]{"", " ",new String(new char[65]).replace('\0','x')}){
            try{PackStore.validateLabels(value,"You");fail("invalid name accepted");}catch(java.io.IOException expected){}
            try{PackStore.validateLabels("Xtreme",value);fail("invalid author accepted");}catch(java.io.IOException expected){}
        }
    }
    @Test public void serverRequiresHttpsOrigin()throws Exception{
        assertEquals("https://example.com",Net.base(" https://example.com/ "));
        for(String value:new String[]{"http://example.com","https://user:secret@example.com","https://example.com/pair","https://example.com?token=x","https://example.com#x"}){
            try{Net.base(value);fail("unsafe URL accepted");}catch(Exception expected){}
        }
    }
    @Test public void readsAreBounded()throws Exception{
        byte[] bytes=new byte[10];assertEquals(10,Net.read(new java.io.ByteArrayInputStream(bytes),10).length);
        try{Net.read(new java.io.ByteArrayInputStream(bytes),9);fail("oversize accepted");}catch(java.io.IOException expected){}
    }
}

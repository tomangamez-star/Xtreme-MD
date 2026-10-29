package com.xtreme.stickers;

import android.content.*;
import android.content.res.AssetFileDescriptor;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.*;
import java.util.*;
import org.json.*;

public final class StickerProvider extends ContentProvider {
    private static final String[] META={"sticker_pack_identifier","sticker_pack_name","sticker_pack_publisher","sticker_pack_icon","android_play_store_link","ios_app_download_link","sticker_pack_publisher_email","sticker_pack_publisher_website","sticker_pack_privacy_policy_website","sticker_pack_license_agreement_website","image_data_version","whatsapp_will_not_cache_stickers","animated_sticker_pack"};
    @Override public boolean onCreate(){return true;}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
        List<String> path=uri.getPathSegments();
        if(path.isEmpty())throw new IllegalArgumentException("Unknown URI");
        if(path.get(0).equals("metadata") && path.size()<=2){
            MatrixCursor cursor=new MatrixCursor(META);
            for(JSONObject p:PackStore.all(getContext())){
                if(path.size()==2&&!p.optString("id").equals(path.get(1)))continue;
                cursor.addRow(new Object[]{p.optString("id"),p.optString("name"),p.optString("author"),"tray.png","","","","","","",p.optString("version","1"),0,p.optBoolean("animated")?1:0});
            }
            cursor.setNotificationUri(getContext().getContentResolver(),uri);return cursor;
        }
        if(path.get(0).equals("stickers")&&path.size()==2){
            MatrixCursor cursor=new MatrixCursor(new String[]{"sticker_file_name","sticker_emoji","sticker_accessibility_text"});
            try {JSONObject p=PackStore.get(getContext(),path.get(1));JSONArray files=p.getJSONArray("stickers");for(int i=0;i<files.length();i++)cursor.addRow(new Object[]{files.getString(i),"",p.optString("name")+" "+(i+1)});}catch(Exception ignored){}
            cursor.setNotificationUri(getContext().getContentResolver(),uri);return cursor;
        }
        throw new IllegalArgumentException("Unknown URI");
    }
    private File asset(Uri uri)throws FileNotFoundException{
        List<String> p=uri.getPathSegments();
        if(p.size()!=3||!p.get(0).equals("stickers_asset"))throw new FileNotFoundException();
        try {
            JSONObject pack=PackStore.get(getContext(),p.get(1));String name=p.get(2);boolean allowed=name.equals("tray.png");
            JSONArray files=pack.getJSONArray("stickers");for(int i=0;i<files.length();i++)allowed|=name.equals(files.getString(i));
            if(!allowed||name.contains("/")||name.contains(".."))throw new FileNotFoundException();
            return new File(PackStore.dir(getContext(),p.get(1)),name);
        }catch(Exception e){throw new FileNotFoundException("Sticker not found");}
    }
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
        if(!mode.equals("r"))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(asset(uri),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public AssetFileDescriptor openAssetFile(Uri uri,String mode)throws FileNotFoundException{return new AssetFileDescriptor(openFile(uri,mode),0,AssetFileDescriptor.UNKNOWN_LENGTH);}
    @Override public String getType(Uri uri){
        List<String> p=uri.getPathSegments();if(p.isEmpty())throw new IllegalArgumentException();
        if(p.get(0).equals("stickers_asset"))return "tray.png".equals(uri.getLastPathSegment())?"image/png":"image/webp";
        return "vnd.android.cursor."+(p.get(0).equals("metadata")&&p.size()==2?"item":"dir")+"/vnd."+getContext().getPackageName()+".provider."+p.get(0);
    }
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}

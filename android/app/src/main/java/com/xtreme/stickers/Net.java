package com.xtreme.stickers;
import java.io.*;
import java.net.*;
import org.json.*;

final class Net {
    static JSONObject post(String base,String path,JSONObject body)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(base(base)+"/api/stickers"+path).openConnection();
        c.setRequestMethod("POST");c.setDoOutput(true);c.setConnectTimeout(20000);c.setReadTimeout(60000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Content-Type","application/json");
        byte[] bytes=body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);
        try{
            try(OutputStream out=c.getOutputStream()){out.write(bytes);}
            int code=c.getResponseCode();
            if(code==404)throw new IOException("Deploy the v1.2 server patch on Render first. This server has no video batch engine yet.");
            if(code!=200&&code!=202){String message="Server returned "+code;try(InputStream in=c.getErrorStream()){if(in!=null)message=new JSONObject(new String(read(in,8192),java.nio.charset.StandardCharsets.UTF_8)).optString("error",message);}throw new IOException(message);}
            try(InputStream in=c.getInputStream()){return new JSONObject(new String(read(in,65536),java.nio.charset.StandardCharsets.UTF_8));}
        }finally{c.disconnect();}
    }
    static void download(String base,String path,File file,int limit)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(base(base)+"/api/stickers"+path).openConnection();
        c.setConnectTimeout(20000);c.setReadTimeout(60000);c.setInstanceFollowRedirects(false);
        boolean complete=false;
        try{
            if(c.getResponseCode()!=200)throw new IOException("Batch download unavailable. Your draft is kept; retry Resume server job.");
            try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(file)){
                byte[] buffer=new byte[8192];int n,total=0;
                while((n=in.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedException();total+=n;if(total>limit)throw new IOException("Batch download exceeds its size limit");out.write(buffer,0,n);}
            }
            complete=true;
        }finally{c.disconnect();if(!complete)file.delete();}
    }
    static String base(String value) throws Exception {
        URI uri = new URI(value.trim());
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IOException("Enter the HTTPS server origin, without /pair or a path");
        return value.trim().replaceAll("/+$", "");
    }
    static byte[] get(String base, String path, int limit) throws Exception {
        for(int attempt=0;;attempt++) {
            try { return getOnce(base,path,limit); }
            catch(RetryLater e) { if(attempt>=2)throw e;Thread.sleep(e.delayMs); }
        }
    }
    private static final class RetryLater extends IOException {
        final long delayMs;
        RetryLater(String message,long delayMs){super(message);this.delayMs=delayMs;}
    }
    private static byte[] getOnce(String base, String path, int limit) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new URL(base(base) + "/api/stickers" + path).openConnection();
        connection.setConnectTimeout(20000); connection.setReadTimeout(60000); connection.setInstanceFollowRedirects(false);
        try {
            int status = connection.getResponseCode();
            if (status != 200) {
                String message = "Server returned " + status;
                try (InputStream error = connection.getErrorStream()) {
                    if (error != null) message = new JSONObject(new String(read(error, 8192), java.nio.charset.StandardCharsets.UTF_8)).optString("error",message);
                } catch (Exception ignored) {}
                if(status==429||status==503) {
                    long seconds=status==429?60:5;
                    try{seconds=Long.parseLong(connection.getHeaderField("Retry-After"));}catch(Exception ignored){}
                    throw new RetryLater(message,Math.min(60,Math.max(1,seconds))*1000);
                }
                throw new IOException(message);
            }
            try (InputStream input = connection.getInputStream()) { return read(input, limit); }
        } finally { connection.disconnect(); }
    }
    static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException();
            if (out.size() + count > limit) throw new IOException("File is too large");
            out.write(buffer,0,count);
        }
        return out.toByteArray();
    }
}

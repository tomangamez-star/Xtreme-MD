package com.xtreme.stickers;

import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class MainActivity extends Activity {
    private final int BG=Color.rgb(9,11,16), PANEL=Color.rgb(20,24,34), LINE=Color.rgb(43,50,66), WHITE=Color.rgb(238,242,250), MUTED=Color.rgb(157,167,188), MINT=Color.rgb(120,244,224), PURPLE=Color.rgb(175,138,255);
    private LinearLayout shell, body, nav;
    private TextView badge, progressText;
    private ProgressBar progress;
    private final ExecutorService worker=Executors.newSingleThreadExecutor(), ping=Executors.newSingleThreadExecutor();
    private Future<?> job;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private String status="Not configured", detail="Add your server address in Settings.", page="Studio";
    private boolean busy=false, checking=false;
    private File draftDir;
    private final ArrayList<File> draftFiles=new ArrayList<>();
    private final ArrayList<Boolean> draftAnimated=new ArrayList<>();
    private final HashSet<Integer> selected=new HashSet<>();
    private String draftName="My Xtreme pack", draftAuthor="Xtreme";
    private final Runnable heartbeat=new Runnable(){public void run(){checkServer();handler.postDelayed(this,60000);}};
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);render();}
    @Override protected void onResume(){super.onResume();handler.removeCallbacks(heartbeat);handler.post(heartbeat);}
    @Override protected void onPause(){super.onPause();handler.removeCallbacks(heartbeat);}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);worker.shutdownNow();ping.shutdownNow();super.onDestroy();}
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private String server(){return getPreferences(0).getString("server","");}
    private void ui(Runnable r){runOnUiThread(()->{if(!isDestroyed()&&!isFinishing())r.run();});}
    private GradientDrawable box(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));d.setStroke(dp(1),LINE);return d;}
    private TextView text(String value,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setFontFeatureSettings("kern");t.setLineSpacing(dp(2),1);if(bold)t.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));return t;}
    private TextView label(String value){TextView t=text(value,11,MUTED,true);t.setLetterSpacing(.16f);return t;}
    private LinearLayout column(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout row(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private void gap(LinearLayout parent,int size){View v=new View(this);parent.addView(v,new LinearLayout.LayoutParams(1,dp(size)));}
    private void click(View v,Runnable action){v.setOnClickListener(w->{w.animate().scaleX(.98f).scaleY(.98f).setDuration(60).withEndAction(()->w.animate().scaleX(1).scaleY(1).setDuration(100));action.run();});}
    private TextView button(String title,boolean primary,Runnable action){TextView t=text(title,14,primary?BG:WHITE,true);t.setGravity(Gravity.CENTER);t.setPadding(dp(16),dp(15),dp(16),dp(15));t.setBackground(new RippleDrawable(ColorStateList.valueOf(0x30FFFFFF),box(primary?MINT:PANEL,16),null));t.setContentDescription(title);click(t,action);return t;}
    private LinearLayout card(){LinearLayout c=column();c.setPadding(dp(18),dp(18),dp(18),dp(18));c.setBackground(box(PANEL,22));return c;}
    private EditText field(LinearLayout parent,String hint,String value){EditText e=new EditText(this);e.setSingleLine(true);e.setTextColor(WHITE);e.setHintTextColor(MUTED);e.setTextSize(15);e.setHint(hint);e.setText(value);e.setPadding(dp(14),dp(14),dp(14),dp(14));e.setBackground(box(BG,12));e.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(hint.contains("https")?250:64)});parent.addView(e,new LinearLayout.LayoutParams(-1,-2));gap(parent,12);return e;}
    private void heading(String eyebrow,String title,String subtitle){body.addView(label(eyebrow));gap(body,10);body.addView(text(title,32,WHITE,true));gap(body,8);body.addView(text(subtitle,14,MUTED,false));gap(body,24);}
    private void render(){
        shell=column();shell.setBackgroundColor(BG);shell.setPadding(dp(20),dp(10),dp(20),0);
        // Use the platform inset values on every supported Android release.
        shell.setOnApplyWindowInsetsListener((v,i)->{shell.setPadding(dp(20),dp(10)+i.getSystemWindowInsetTop(),dp(20),i.getSystemWindowInsetBottom());return i.consumeSystemWindowInsets();});
        setContentView(shell);
        LinearLayout top=row();TextView brand=text("X / STICKERS",15,WHITE,true);brand.setLetterSpacing(.12f);top.addView(brand,new LinearLayout.LayoutParams(0,dp(44),1));
        badge=text("",11,MINT,true);badge.setPadding(dp(10),dp(8),dp(10),dp(8));badge.setBackground(box(PANEL,20));click(badge,()->new AlertDialog.Builder(this).setTitle("Server connection").setMessage(detail+"\n\nThis is the sticker server, not a WhatsApp bot session.").setPositiveButton("Check again",(d,w)->checkServer()).setNeutralButton("Settings",(d,w)->show("Settings")).setNegativeButton("Close",null).show());top.addView(badge);shell.addView(top);updateBadge();
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setClipToPadding(false);body=column();body.setPadding(0,dp(24),0,dp(28));scroll.addView(body);shell.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        nav=row();nav.setPadding(0,dp(8),0,dp(10));for(String name:new String[]{"Studio","Create","Packs","Settings"}){TextView tab=text(name,12,page.equals(name)?MINT:MUTED,true);tab.setGravity(Gravity.CENTER);tab.setPadding(0,dp(14),0,dp(14));if(page.equals(name))tab.setBackground(box(PANEL,14));nav.addView(tab,new LinearLayout.LayoutParams(0,-2,1));click(tab,()->show(name));}shell.addView(nav);
        if(busy){busyScreen();return;}
        switch(page){case "Create":createScreen();break;case "Packs":library();break;case "Settings":settings();break;case "Review":review();break;default:home();}
    }
    private void show(String next){if(busy){toast("Finish or cancel the current conversion first");return;}page=next;render();}
    private void home(){
        heading("YOUR EXPRESSION. UPGRADED.","Small stickers.\nXtreme energy.","Bring your favourite reactions with you.");
        LinearLayout hero=card();hero.setPadding(0,0,0,dp(20));hero.addView(new Hero(this),new LinearLayout.LayoutParams(-1,dp(210)));
        LinearLayout inner=column();inner.setPadding(dp(20),0,dp(20),0);inner.addView(label("TELEGRAM  →  WHATSAPP"));gap(inner,10);inner.addView(text("One link. A whole pack.",23,WHITE,true));gap(inner,8);inner.addView(text("Static or animated. Your name, your labels.\nConverted privately on your phone.",14,MUTED,false));gap(inner,18);inner.addView(button("↗  Import a Telegram pack",true,this::importDialog));hero.addView(inner);body.addView(hero);gap(body,22);
        LinearLayout actions=row();LinearLayout local=card();local.addView(text("＋",27,PURPLE,true));gap(local,12);local.addView(text("Make it yours",16,WHITE,true));gap(local,6);local.addView(text("Photos, GIFs & clips",12,MUTED,false));click(local,()->show("Create"));actions.addView(local,new LinearLayout.LayoutParams(0,dp(145),1));View spacer=new View(this);actions.addView(spacer,new LinearLayout.LayoutParams(dp(12),1));LinearLayout saved=card();saved.addView(text(String.format(Locale.US,"%02d",PackStore.all(this).size()),27,MINT,true));gap(saved,12);saved.addView(text("Your collection",16,WHITE,true));gap(saved,6);saved.addView(text("Always ready offline",12,MUTED,false));click(saved,()->show("Packs"));actions.addView(saved,new LinearLayout.LayoutParams(0,dp(145),1));body.addView(actions);gap(body,24);body.addView(label("NO BOT PAIRING. NO STICKER SPAM."));
        if(!draftFiles.isEmpty()){gap(body,18);body.addView(button("Continue unsaved pack →",false,()->show("Review")));}
    }
    private void createScreen(){heading("THE CREATOR LAB","Made by you.","Turn photos, GIFs and short videos into a pack. Everything stays on this device.");
        LinearLayout c=card();c.addView(text("＋",56,PURPLE,true));gap(c,16);c.addView(text("Start with your camera roll",22,WHITE,true));gap(c,10);c.addView(text("Select 3 or more photos, or 3 or more GIFs / videos. Animations use the first 10 seconds. Static and animated stickers stay in separate packs.",15,MUTED,false));gap(c,22);c.addView(button("Choose photos & videos",true,()->confirmDraft(this::pickMedia)));body.addView(c);gap(body,18);body.addView(text("Images are fitted inside a transparent square. Background removal and manual cropping are not included in this first version.",13,MUTED,false));}
    private void pickMedia(){Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.setType("*/*");pick.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","video/*"});pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);pick.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(pick,10);}
    private void importDialog(){confirmDraft(()->{LinearLayout fields=dialogFields();EditText url=field(fields,"https://t.me/addstickers/PackName","");new AlertDialog.Builder(this).setTitle("Import from Telegram").setView(fields).setPositiveButton("Import",(d,w)->{
        try {Uri u=Uri.parse(url.getText().toString().trim());if(!"https".equals(u.getScheme())||!("t.me".equals(u.getHost())||"telegram.me".equals(u.getHost()))||u.getUserInfo()!=null||u.getPort()!=-1||u.getQuery()!=null||u.getFragment()!=null||!u.getPath().matches("/addstickers/[A-Za-z0-9_]{1,64}/?"))throw new IOException("Use a public https://t.me/addstickers/PackName link");Net.base(server());startImport(u.getPathSegments().get(1));}catch(Exception e){error(e.getMessage());}
    }).setNegativeButton("Cancel",null).show();});}
    private LinearLayout dialogFields(){LinearLayout l=column();l.setPadding(dp(24),dp(16),dp(24),dp(8));return l;}
    private void confirmDraft(Runnable next){if(draftFiles.isEmpty()){next.run();return;}new AlertDialog.Builder(this).setTitle("Replace unsaved draft?").setMessage("Saved packs are unaffected.").setPositiveButton("Replace draft",(d,w)->{clearDraft();next.run();}).setNegativeButton("Keep draft",null).show();}
    private void clearDraft(){if(draftDir!=null)PackStore.removeTree(draftDir);draftDir=null;draftFiles.clear();draftAnimated.clear();selected.clear();}
    private void newDraft()throws IOException{clearDraft();draftDir=Files.createTempDirectory(getCacheDir().toPath(),"draft-").toFile();}
    interface Task{void run()throws Exception;}
    private void runJob(Task task){busy=true;render();job=worker.submit(()->{try{task.run();ui(()->{busy=false;page=draftFiles.isEmpty()?"Packs":"Review";render();});}catch(Exception e){boolean cancelled=Thread.currentThread().isInterrupted()||e instanceof InterruptedException||e instanceof InterruptedIOException;ui(()->{busy=false;page=draftFiles.isEmpty()?"Studio":"Review";render();error(cancelled?"Cancelled. Any completed stickers are kept in your draft.":(e.getMessage()==null?"Something went wrong. Please retry.":e.getMessage()));});}});}
    private void report(String message,int done,int total){ui(()->{if(progressText!=null)progressText.setText(message);if(progress!=null){progress.setIndeterminate(total<=0);if(total>0){progress.setMax(total);progress.setProgress(done);}}});}
    private void busyScreen(){heading("WORKING ON YOUR DEVICE","Making magic.","Keep the app open while your pack is prepared.");body.addView(new Hero(this),new LinearLayout.LayoutParams(-1,dp(220)));gap(body,24);progressText=text("Preparing…",16,WHITE,true);body.addView(progressText);gap(body,20);progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setIndeterminate(true);progress.setProgressTintList(ColorStateList.valueOf(MINT));body.addView(progress,new LinearLayout.LayoutParams(-1,dp(8)));gap(body,24);body.addView(button("Cancel conversion",false,()->{if(job!=null)job.cancel(true);toast("Cancelling…");}));}
    private void addConverted(File source,String format,int index)throws Exception{
        boolean animated=!format.equals("webp")&&!format.equals("image");
        long started=SystemClock.elapsedRealtime();
        report("Converting sticker "+(index+1)+" · native fast engine…",index,0);
        byte[] bytes=animated?Converter.animation(source,format,new File(getCacheDir(),"converted-v2")):Converter.staticImage(source);
        animated=Converter.isAnimatedWebp(bytes);
        File out=new File(draftDir,"sticker-"+index+".webp");Files.write(out.toPath(),bytes);
        // libwebp legitimately collapses identical animation frames to a still.
        if(!animated&&bytes.length>100*1024)Files.write(out.toPath(),Converter.staticImage(out));
        draftFiles.add(out);draftAnimated.add(animated);selected.add(draftFiles.size()-1);source.delete();
        android.util.Log.i("XtremeConvert",format+" sticker="+(index+1)+" ms="+(SystemClock.elapsedRealtime()-started)+" bytes="+out.length());
    }
    private void startImport(String name){
        runJob(()->{
            newDraft();report("Loading Telegram pack…",0,0);
            JSONObject pack=new JSONObject(new String(Net.get(server(),"/packs/"+name,2*1024*1024),StandardCharsets.UTF_8));
            draftName=pack.getString("title");if(draftName.length()>54)draftName=draftName.substring(0,54);draftAuthor="Xtreme";
            JSONArray list=pack.getJSONArray("stickers");if(list.length()>200)throw new IOException("Pack is too large");
            ExecutorService downloads=Executors.newSingleThreadExecutor();
            Future<byte[]> pending=null;
            try{
                for(int i=0;i<list.length();i++){
                    if(Thread.currentThread().isInterrupted())throw new InterruptedException();
                    if(pending==null){final String ticket=downloadTicket(list.getJSONObject(i));pending=downloads.submit(()->Net.get(server(),"/files/"+ticket,5*1024*1024));}
                    report("Preparing "+(i+1)+" / "+list.length()+" · overlapping download + conversion",i,list.length());
                    byte[] bytes;
                    try{bytes=pending.get();}catch(ExecutionException e){if(e.getCause() instanceof Exception)throw (Exception)e.getCause();throw e;}
                    pending=null;
                    // Only one look-ahead file is held in memory, not the whole pack.
                    if(i+1<list.length()){final String ticket=downloadTicket(list.getJSONObject(i+1));pending=downloads.submit(()->Net.get(server(),"/files/"+ticket,5*1024*1024));}
                    File source=new File(draftDir,"source");Files.write(source.toPath(),bytes);
                    addConverted(source,list.getJSONObject(i).getString("format"),i);
                }
            }finally{if(pending!=null)pending.cancel(true);downloads.shutdownNow();}
        });
    }
    private String downloadTicket(JSONObject item)throws Exception{
        String ticket=item.getString("ticket");if(!ticket.matches("[a-f0-9]{48}"))throw new IOException("Invalid server response");return ticket;
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==20){if(result==RESULT_OK)toast("Pack added to WhatsApp");else if(data!=null&&data.getStringExtra("validation_error")!=null)error(data.getStringExtra("validation_error"));return;}if(request!=10||result!=RESULT_OK||data==null)return;ArrayList<Uri> uris=new ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());if(uris.size()>200){error("Choose up to 200 files at a time");return;}runJob(()->{newDraft();draftName="My Xtreme pack";draftAuthor="Xtreme";for(int i=0;i<uris.size();i++){report("Converting "+(i+1)+" / "+uris.size(),i,uris.size());Uri uri=uris.get(i);String mime=getContentResolver().getType(uri);String format=mime!=null&&mime.startsWith("video/")?"video":"image/gif".equals(mime)?"gif":"image";File source=new File(draftDir,"source");try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("Cannot open media");Files.write(source.toPath(),Net.read(in,30*1024*1024));}addConverted(source,format,i);}});}
    private void review(){heading("PACK WORKSHOP","A little more you.","Tap to include or exclude stickers. Static and animated selections are saved separately.");EditText name=field(body,"Pack name",draftName),author=field(body,"Author",draftAuthor);body.addView(text(draftFiles.size()+" converted stickers • tap any tile to select",13,MUTED,false));gap(body,16);GridLayout grid=new GridLayout(this);grid.setColumnCount(3);for(int i=0;i<draftFiles.size();i++){final int index=i;LinearLayout tile=column();tile.setPadding(dp(6),dp(6),dp(6),dp(6));tile.setBackground(box(selected.contains(i)?0xFF1D3B3C:PANEL,16));ImageView image=preview(draftFiles.get(i));tile.addView(image,new LinearLayout.LayoutParams(-1,dp(86)));TextView caption=text((draftAnimated.get(i)?"ANIMATED":"STATIC")+"  "+(selected.contains(i)?"✓":"○"),9,selected.contains(i)?MINT:MUTED,true);caption.setGravity(Gravity.CENTER);tile.addView(caption);GridLayout.LayoutParams lp=new GridLayout.LayoutParams();lp.width=0;lp.columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);lp.setMargins(dp(3),dp(3),dp(3),dp(3));grid.addView(tile,lp);click(tile,()->{if(!selected.remove(index))selected.add(index);tile.setBackground(box(selected.contains(index)?0xFF1D3B3C:PANEL,16));caption.setText((draftAnimated.get(index)?"ANIMATED":"STATIC")+"  "+(selected.contains(index)?"✓":"○"));});}body.addView(grid);gap(body,20);body.addView(button("Save selected stickers as packs →",true,()->{draftName=name.getText().toString().trim();draftAuthor=author.getText().toString().trim();ArrayList<File> still=new ArrayList<>(),animated=new ArrayList<>();for(int i=0;i<draftFiles.size();i++)if(selected.contains(i))(draftAnimated.get(i)?animated:still).add(draftFiles.get(i));try{PackStore.validateLabels(draftName,draftAuthor);if((still.size()>0&&still.size()<3)||(animated.size()>0&&animated.size()<3)||selected.isEmpty())throw new IOException("Select at least 3 stickers of each included type. You can deselect a smaller group.");}catch(Exception e){error(e.getMessage());return;}runJob(()->{ArrayList<String> created=new ArrayList<>();try{if(!still.isEmpty())created.addAll(PackStore.save(this,still,false,draftName+(animated.isEmpty()?"":" · Static"),draftAuthor));if(!animated.isEmpty())created.addAll(PackStore.save(this,animated,true,draftName+(still.isEmpty()?"":" · Motion"),draftAuthor));}catch(Exception e){for(String id:created)PackStore.removeTree(PackStore.dir(this,id));throw e;}clearDraft();});}));}
    private ImageView preview(File file){ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.FIT_CENTER);try{ImageDecoder.Source source=ImageDecoder.createSource(file);Drawable d=ImageDecoder.decodeDrawable(source,(decoder,info,s)->decoder.setTargetSize(128,128));image.setImageDrawable(d);if(d instanceof AnimatedImageDrawable)((AnimatedImageDrawable)d).start();}catch(Exception ignored){}return image;}
    private void library(){heading("THE COLLECTION","Your sticker vault.","Saved on your phone. Ready for WhatsApp—even offline.");List<JSONObject> packs=PackStore.all(this);if(packs.isEmpty()){LinearLayout c=card();c.addView(text("✦",52,PURPLE,true));gap(c,16);c.addView(text("Your first pack starts here",22,WHITE,true));gap(c,10);c.addView(text("Import a Telegram link or create something completely yours.",14,MUTED,false));gap(c,20);c.addView(button("Import a pack",true,this::importDialog));body.addView(c);}for(JSONObject p:packs){LinearLayout c=card();LinearLayout line=row();line.addView(text(p.optBoolean("animated")?"◉  MOTION":"◇  STATIC",11,p.optBoolean("animated")?PURPLE:MINT,true),new LinearLayout.LayoutParams(0,-2,1));TextView edit=text("•••",22,MUTED,true);edit.setPadding(dp(16),0,0,0);line.addView(edit);click(edit,()->packOptions(p));c.addView(line);gap(c,12);c.addView(text(p.optString("name"),21,WHITE,true));gap(c,4);c.addView(text(p.optJSONArray("stickers").length()+" stickers · "+p.optString("author"),12,MUTED,false));gap(c,16);LinearLayout previews=row();JSONArray files=p.optJSONArray("stickers");for(int i=0;i<Math.min(4,files.length());i++){ImageView im=preview(new File(PackStore.dir(this,p.optString("id")),files.optString(i)));previews.addView(im,new LinearLayout.LayoutParams(0,dp(66),1));}c.addView(previews);gap(c,18);c.addView(button("Add whole pack to WhatsApp  ↗",true,()->addWhatsApp(p)));body.addView(c);gap(body,16);}}
    private void packOptions(JSONObject p){new AlertDialog.Builder(this).setTitle(p.optString("name")).setItems(new String[]{"Preview & choose tray icon","Edit name and author","Delete from this app"},(d,n)->{if(n==0)packPreview(p);else if(n==1){LinearLayout f=dialogFields();EditText name=field(f,"Pack name",p.optString("name")),author=field(f,"Author",p.optString("author"));AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Pack labels").setView(f).setPositiveButton("Save",null).setNegativeButton("Cancel",null).create();dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(w->{try{PackStore.rename(this,p.optString("id"),name.getText().toString(),author.getText().toString());dialog.dismiss();render();}catch(Exception e){error(e.getMessage());}}));dialog.show();}else new AlertDialog.Builder(this).setTitle("Delete this pack?").setMessage("This removes its files from this app. Remove it from WhatsApp first if you no longer want it there. This cannot be undone.").setPositiveButton("Delete",(a,b)->{PackStore.removeTree(PackStore.dir(this,p.optString("id")));render();}).setNegativeButton("Keep",null).show();}).show();}
    private void packPreview(JSONObject p){ScrollView scroll=new ScrollView(this);LinearLayout list=dialogFields();scroll.addView(list);JSONArray files=p.optJSONArray("stickers");list.addView(text("Tap a sticker to use it as the tray icon.",14,MUTED,false));for(int i=0;i<files.length();i++){final int index=i;ImageView im=preview(new File(PackStore.dir(this,p.optString("id")),files.optString(i)));list.addView(im,new LinearLayout.LayoutParams(-1,dp(120)));click(im,()->{try{PackStore.tray(this,p.optString("id"),index);toast("Tray icon updated. Re-add the pack to refresh WhatsApp.");}catch(Exception e){error(e.getMessage());}});}new AlertDialog.Builder(this).setTitle(p.optString("name")).setView(scroll).setPositiveButton("Done",null).show();}
    private void addWhatsApp(JSONObject p){ArrayList<String> packages=new ArrayList<>(),labels=new ArrayList<>();for(String pkg:new String[]{"com.whatsapp","com.whatsapp.w4b"})try{getPackageManager().getPackageInfo(pkg,0);packages.add(pkg);labels.add(pkg.endsWith("w4b")?"WhatsApp Business":"WhatsApp");}catch(Exception ignored){}if(packages.isEmpty()){error("Install WhatsApp or WhatsApp Business first.");return;}if(packages.size()==1){launchPack(p,packages.get(0));return;}new AlertDialog.Builder(this).setTitle("Add pack to…").setItems(labels.toArray(new String[0]),(d,w)->launchPack(p,packages.get(w))).show();}
    private void launchPack(JSONObject p,String pkg){try{Intent intent=new Intent("com.whatsapp.intent.action.ENABLE_STICKER_PACK");intent.setPackage(pkg);intent.putExtra("sticker_pack_id",p.optString("id"));intent.putExtra("sticker_pack_authority",getPackageName()+".provider");intent.putExtra("sticker_pack_name",p.optString("name"));startActivityForResult(intent,20);}catch(ActivityNotFoundException e){error("This WhatsApp version does not support adding sticker packs. Update it and retry.");}}
    private void settings(){heading("SYSTEM CONTROL","Stay connected.","Your server fetches Telegram files. Your phone does the creative work.");LinearLayout c=card();c.addView(label("XTREME SERVER"));gap(c,14);EditText url=field(c,"https://your-server.onrender.com",server());url.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);c.addView(text("Use the base HTTPS address, without /pair. Never enter a Telegram token here.",13,MUTED,false));gap(c,16);c.addView(button("Save & check connection",true,()->{try{String base=Net.base(url.getText().toString());getPreferences(0).edit().putString("server",base).apply();checkServer();toast("Server saved");}catch(Exception e){error(e.getMessage());}}));body.addView(c);gap(body,22);body.addView(label("LOCAL BY DESIGN"));gap(body,12);body.addView(text("• No WhatsApp pairing or bot login\n• No account, analytics or cloud media uploads\n• Saved packs and local creation work offline\n• Keep this app installed to provide your packs\n\nTelegram imports require this server’s sticker API and TELEGRAM_BOT_TOKEN. Connected checks the API and Telegram access; Limited means the API is reachable but Telegram is unavailable.",14,MUTED,false));gap(body,24);body.addView(text("XTREME STICKERS  /  1.1\nIndependent project. Not affiliated with WhatsApp or Telegram.",11,MUTED,false));}
    private void updateBadge(){if(badge!=null){badge.setText("●  "+status);badge.setTextColor(status.equals("Connected")?MINT:status.equals("Checking")?MUTED:PURPLE);}}
    private void checkServer(){if(checking)return;if(server().isEmpty()){status="Set server";detail="Add your Render HTTPS address in Settings.";updateBadge();return;}checking=true;status="Checking";updateBadge();final String base=server();ping.submit(()->{long start=System.currentTimeMillis();String state,info;try{JSONObject result=new JSONObject(new String(Net.get(base,"/health",8192),StandardCharsets.UTF_8));if(result.optInt("api")!=1)throw new IOException("This server needs the sticker API patch");state=result.optBoolean("telegram")?"Connected":"Limited";info=base+"\n"+(System.currentTimeMillis()-start)+" ms · "+(state.equals("Connected")?"Telegram is reachable.":"API reachable; check TELEGRAM_BOT_TOKEN on the server.");}catch(Exception e){state="Disconnected";info="Could not reach the sticker API. The server may be waking up.\n"+e.getMessage();}final String next=state,description=info;ui(()->{checking=false;status=next;detail=description;updateBadge();});});}
    private void toast(String value){Toast.makeText(this,value,Toast.LENGTH_LONG).show();}
    private void error(String message){new AlertDialog.Builder(this).setTitle("A quick heads-up").setMessage(message).setPositiveButton("Got it",null).show();}
    private final class Hero extends View{
        final Paint p=new Paint(3);
        final Typeface heavy=Typeface.create("sans-serif-black",Typeface.BOLD);
        Shader glow;
        Hero(Context c){super(c);setContentDescription("Xtreme cyan and violet geometric emblem");}
        @Override protected void onSizeChanged(int w,int h,int oldW,int oldH){
            if(w>0)glow=new RadialGradient(w*.56f,h*.5f,w*.48f,new int[]{0x493E2585,0x112E544F,0x00141822},null,Shader.TileMode.CLAMP);
        }
        @Override protected void onDraw(Canvas c){
            float w=getWidth(),h=getHeight();p.setShader(glow);c.drawRect(0,0,w,h,p);p.setShader(null);
            p.setColor(0x153F6974);p.setStrokeWidth(dp(1));
            for(int i=0;i<8;i++)c.drawLine(w*i/7,0,w*i/7,h,p);
            for(int i=0;i<5;i++)c.drawLine(0,h*i/4,w,h*i/4,p);
            c.save();c.translate(w/2,h/2);c.rotate(-9);p.setColor(0x332E4751);
            c.drawRoundRect(-dp(66),-dp(66),dp(66),dp(66),dp(28),dp(28),p);
            p.setStyle(Paint.Style.STROKE);p.setColor(0x8078F4E0);
            c.drawRoundRect(-dp(66),-dp(66),dp(66),dp(66),dp(28),dp(28),p);
            p.setStyle(Paint.Style.FILL);p.setTypeface(heavy);p.setTextSize(dp(116));
            p.setColor(PURPLE);c.drawText("X",-dp(36),dp(42),p);p.setColor(MINT);c.drawText("X",-dp(41),dp(38),p);
            p.setColor(PANEL);c.drawRect(-dp(50),-dp(2),dp(50),dp(3),p);c.restore();
            p.setTypeface(Typeface.MONOSPACE);p.setTextSize(dp(10));p.setColor(MINT);
            c.drawText("[ EXPRESS / REPEAT ]",dp(20),h-dp(18),p);p.setColor(PURPLE);c.drawCircle(w-dp(26),dp(26),dp(4),p);
        }
    }
}

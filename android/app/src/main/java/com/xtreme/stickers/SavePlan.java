package com.xtreme.stickers;
final class SavePlan {
    final boolean saveStatic,saveAnimated;
    final int retained;
    SavePlan(int still,int animated){saveStatic=still>=3;saveAnimated=animated>=3;retained=(saveStatic?0:still)+(saveAnimated?0:animated);}
    boolean canSave(){return saveStatic||saveAnimated;}
}

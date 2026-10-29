package com.xtreme.stickers;
import org.junit.Test;
import static org.junit.Assert.*;
public class SavePlanTest {
    @Test public void oneAnimatedNeverBlocks49Static(){SavePlan p=new SavePlan(49,1);assertTrue(p.canSave());assertTrue(p.saveStatic);assertFalse(p.saveAnimated);assertEquals(1,p.retained);}
    @Test public void mixedEligibleGroupsBothSave(){SavePlan p=new SavePlan(4,50);assertTrue(p.saveStatic);assertTrue(p.saveAnimated);assertEquals(0,p.retained);}
    @Test public void smallGroupsAreRetained(){SavePlan p=new SavePlan(2,1);assertFalse(p.canSave());assertEquals(3,p.retained);}
    @Test public void twoStaticDoNotBlock50Animated(){SavePlan p=new SavePlan(2,50);assertTrue(p.saveAnimated);assertFalse(p.saveStatic);assertEquals(2,p.retained);}
}

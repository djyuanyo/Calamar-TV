package es.yuanyo.calamartv;

import android.content.Context;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.*;
import java.util.*;

/** Minimal account metadata for the administrator. No credentials, tokens or viewing history. */
final class UserDirectory {
  private UserDirectory() {}
  static Task<Void> touch(Context context, FirebaseUser user) {
    if (user == null || user.isAnonymous()) return Tasks.forResult(null);
    return user.getIdToken(false).onSuccessTask(token -> {
      if (SharedCatalog.auth(context).getCurrentUser() == null || !user.getUid().equals(SharedCatalog.auth(context).getCurrentUser().getUid())) return Tasks.forResult(null);
      Map<String,Object> claims = token.getClaims(); Object firebase = claims.get("firebase");
      String provider = firebase instanceof Map ? String.valueOf(((Map<?,?>)firebase).get("sign_in_provider")) : "";
      Map<String,Object> value = new HashMap<>();
      value.put("name", user.getDisplayName() == null ? "" : user.getDisplayName().substring(0, Math.min(80, user.getDisplayName().length())));
      value.put("email", claims.get("email") instanceof String ? claims.get("email") : "");
      String photo = user.getPhotoUrl() == null ? "" : user.getPhotoUrl().toString(); value.put("photo", photo.substring(0, Math.min(2048, photo.length())));
      value.put("verified", Boolean.TRUE.equals(claims.get("email_verified"))); value.put("provider", provider); value.put("lastSeen", FieldValue.serverTimestamp());
      if (user.getMetadata() != null) value.put("registeredAt", new Date(user.getMetadata().getCreationTimestamp()));
      DocumentReference ref = FirebaseFirestore.getInstance(SharedCatalog.app(context)).document("calamarMembers/" + user.getUid());
      return ref.getFirestore().runTransaction(tx -> { DocumentSnapshot before = tx.get(ref); Map<String,Object> update = new HashMap<>(value); if (!before.exists()) update.put("createdAt", FieldValue.serverTimestamp()); tx.set(ref, update, SetOptions.merge()); return null; });
    });
  }
}

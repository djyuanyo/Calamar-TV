package es.yuanyo.calamartv;

import android.app.AlertDialog;
import android.content.Context;
import android.widget.Button;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.CollectionReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import java.util.HashMap;
import java.util.Map;

final class ChannelReports {
  private ChannelReports() {}

  static CollectionReference inbox(Context context) {
    return FirebaseFirestore.getInstance(SharedCatalog.app(context)).collection("calamarChannelReports");
  }

  static Task<Void> markRead(DocumentSnapshot report) {
    return report.getReference().update("readAt", FieldValue.serverTimestamp());
  }

  static AlertDialog offer(Context context, String target, String title, String device) {
    AlertDialog dialog = new AlertDialog.Builder(context)
        .setTitle("No se ha podido reproducir")
        .setMessage("¿Quieres avisar al administrador del fallo en «" + title + "»?")
        .setNegativeButton("Cerrar", null)
        .setPositiveButton("Avisar al administrador", null)
        .create();
    dialog.setOnShowListener(ignored -> {
      Button send = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
      send.setOnClickListener(view -> {
        FirebaseUser user = Profiles.user(context);
        if (user == null || user.isAnonymous() || !user.isEmailVerified()) {
          dialog.setMessage("Inicia sesión con tu cuenta verificada para enviar el aviso.");
          return;
        }
        send.setEnabled(false);
        dialog.setMessage("Enviando…");
        Map<String, Object> data = new HashMap<>();
        data.put("target", target);
        data.put("title", title.substring(0, Math.min(title.length(), 250)));
        data.put("device", device);
        data.put("createdAt", FieldValue.serverTimestamp());
        data.put("readAt", null);
        inbox(context).document().set(data).addOnCompleteListener(task -> {
          if (!dialog.isShowing()) return;
          if (task.isSuccessful()) {
            dialog.setMessage("Aviso enviado al administrador.");
            send.setVisibility(android.view.View.GONE);
          } else {
            dialog.setMessage("No se pudo enviar el aviso. Vuelve a intentarlo.");
            send.setEnabled(true);
          }
        });
      });
    });
    dialog.show();
    return dialog;
  }
}

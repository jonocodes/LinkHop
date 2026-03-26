from django.db import migrations, models
import django.db.models.deletion


def delete_senderless_messages(apps, schema_editor):
    Message = apps.get_model("core", "Message")
    Message.objects.filter(sender_device__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_add_allow_self_send"),
    ]

    operations = [
        migrations.RunPython(
            delete_senderless_messages,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="message",
            name="sender_device",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="sent_messages",
                to="core.device",
            ),
        ),
    ]

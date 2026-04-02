from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0016_remove_message_log"),
    ]

    operations = [
        migrations.AddField(
            model_name="pushsubscription",
            name="client_type",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]

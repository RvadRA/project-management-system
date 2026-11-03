from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('matching', '0009_capacity_ratings_catalog')]

    operations = [
        migrations.CreateModel(
            name='EmployeeExperienceEmbedding',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_hash', models.CharField(max_length=64)),
                ('vector', models.JSONField(default=list)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('employee', models.OneToOneField(on_delete=models.deletion.CASCADE, related_name='experience_embedding', to='matching.employeeprofile')),
            ],
        ),
    ]
